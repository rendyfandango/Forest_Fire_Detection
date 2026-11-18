import os
import time
import json
import ssl
import logging
import serial
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("SerialGateway")

# Configuration from .env
SERIAL_PORT = os.getenv('SERIAL_PORT', '/dev/ttyUSB0')
SERIAL_BAUDRATE = int(os.getenv('SERIAL_BAUDRATE', 9600))

MQTT_BROKER = os.getenv('MQTT_BROKER')
MQTT_PORT = int(os.getenv('MQTT_PORT', 8883))
MQTT_USER = os.getenv('MQTT_USER')
MQTT_PASSWORD = os.getenv('MQTT_PASSWORD')
import random
import string
MQTT_CLIENT_ID = f"raspi_fire_gateway_{''.join(random.choices(string.ascii_letters + string.digits, k=6))}"
# Sensor Topics (3 Topics)
SUHU_TOPIC = "Kel6/FireDetector/sensor/suhu"
ASAP_TOPIC = "Kel6/FireDetector/sensor/asap"
API_TOPIC = "Kel6/FireDetector/sensor/api"

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Initialize Supabase Client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")

# Global MQTT Client
mqtt_client = None
mqtt_connected = False

def on_connect(client, userdata, flags, rc):
    global mqtt_connected
    if rc == 0:
        logger.info("Connected to HiveMQ Cloud MQTT Broker!")
        mqtt_connected = True
    else:
        logger.error(f"MQTT Connection failed with code {rc}")
        mqtt_connected = False

def on_disconnect(client, userdata, rc):
    global mqtt_connected
    logger.warning("Disconnected from MQTT Broker.")
    mqtt_connected = False

def connect_mqtt():
    global mqtt_client, mqtt_connected
    try:
        mqtt_client = mqtt.Client(client_id=MQTT_CLIENT_ID, transport="tcp")
        mqtt_client.on_connect = on_connect
        mqtt_client.on_disconnect = on_disconnect
        mqtt_client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
        
        # Enable SSL/TLS
        context = ssl.create_default_context()
        mqtt_client.tls_set_context(context)
        
        logger.info(f"Connecting to MQTT Broker at {MQTT_BROKER}:{MQTT_PORT}...")
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        mqtt_client.loop_start()
    except Exception as e:
        logger.error(f"Failed to connect to MQTT: {e}")
        mqtt_connected = False

# Robust function to save log to Supabase supporting varying schemas
def save_to_supabase(suhu, api, asap, status):
    if not supabase:
        logger.warning("Supabase client is not available. Skipping DB write.")
        return False
        
    # Attempt 1: Standard Indonesian Schema (suhu, api, asap, status)
    payload_1 = {
        "suhu": suhu,
        "api": api,
        "asap": asap,
        "status": status
    }
    
    # Attempt 2: Alternative Indonesian Schema (suhu, status_api, status_asap, status_sistem)
    payload_2 = {
        "suhu": suhu,
        "status_api": api,
        "status_asap": asap,
        "status_sistem": status
    }
    
    # Attempt 3: English Schema (temperature, flame, smoke, status)
    payload_3 = {
        "temperature": suhu,
        "flame": api,
        "smoke": asap,
        "status": status
    }

    attempts = [payload_1, payload_2, payload_3]
    
    for i, payload in enumerate(attempts, 1):
        try:
            logger.info(f"Attempting DB insert {i} with payload: {payload}")
            supabase.table("sensor_logs").insert(payload).execute()
            logger.info("Log successfully saved to Supabase database.")
            return True
        except Exception as e:
            err_msg = str(e)
            logger.warning(f"DB insert attempt {i} failed: {err_msg}")
            # If it's a Column Not Found or relation issue, try the next schema.
            # Continue loop
            
    logger.error("All Supabase DB insert attempts failed. Check table schema.")
    return False

def parse_serial_data(line):
    """
    Parses serial data line. Supports:
    1. JSON format: {"suhu": 30.2, "api": false, "asap": false, "status": "AMAN"}
    2. Comma-separated format: 30.2,0,0,AMAN (Suhu, Api, Asap, Status)
    """
    line = line.strip()
    if not line:
        return None
        
    logger.info(f"Raw Serial Input: {line}")
    
    # Try parsing as JSON first
    try:
        data = json.loads(line)
        # Normalize keys to standard local variables
        suhu = float(data.get('suhu', data.get('temperature', data.get('temp', 0.0))))
        
        # Flame boolean parsing
        flame_val = data.get('api', data.get('flame', data.get('fire', False)))
        api = (flame_val is True or str(flame_val).upper() in ['ON', '1', 'FIRE', 'TERDETEKSI'])
        
        # Smoke boolean parsing
        smoke_val = data.get('asap', data.get('smoke', data.get('gas', False)))
        asap = (smoke_val is True or str(smoke_val).upper() in ['ON', '1', 'GAS', 'SMOKE', 'TERDETEKSI'])
        
        status = str(data.get('status', data.get('sistem', data.get('system_status', 'AMAN')))).upper()
        
        return suhu, api, asap, status
    except json.JSONDecodeError:
        # Fallback to Comma Separated parsing: suhu,api,asap,status (e.g. 29.5,0,0,AMAN)
        try:
            parts = line.split(',')
            if len(parts) >= 4:
                suhu = float(parts[0])
                api = (parts[1].strip() in ['1', 'true', 'TRUE', 'ON', 'on'])
                asap = (parts[2].strip() in ['1', 'true', 'TRUE', 'ON', 'on'])
                status = parts[3].strip().upper()
                return suhu, api, asap, status
        except Exception as csv_err:
            logger.error(f"Failed to parse serial line as CSV: {csv_err}")
            
    return None

def main():
    logger.info("Starting Serial Gateway for IoT Fire Detector...")
    connect_mqtt()
    
    ser = None
    last_db_write_time = 0
    db_write_interval = 10  # Save to Supabase at most every 10 seconds to avoid API spamming, or instantly on alert
    
    while True:
        try:
            if not ser:
                logger.info(f"Opening Serial Port {SERIAL_PORT} at {SERIAL_BAUDRATE} baud...")
                ser = serial.Serial(SERIAL_PORT, SERIAL_BAUDRATE, timeout=1)
                logger.info("Serial Port opened successfully!")
                
            # Read a line from serial
            line = ser.readline().decode('utf-8', errors='ignore')
            if not line:
                continue
                
            parsed = parse_serial_data(line)
            if not parsed:
                continue
                
            suhu, api, asap, status = parsed
            logger.info(f"Parsed Data -> Suhu: {suhu}°C, Api: {api}, Asap: {asap}, Status: {status}")
            
            # 1. Publish to MQTT Broker
            if mqtt_client and mqtt_connected:
                # Publish raw value strings to 3 separate topics
                mqtt_client.publish(SUHU_TOPIC, str(suhu), qos=1)
                mqtt_client.publish(ASAP_TOPIC, "1" if asap else "0", qos=1)
                mqtt_client.publish(API_TOPIC, "1" if api else "0", qos=1)
                logger.info(f"Sensor data published to separate MQTT topics -> Suhu: {suhu}, Asap: {asap}, Api: {api}")
            else:
                logger.warning("MQTT not connected. Retrying connection...")
                connect_mqtt()
                
            # 2. Write to Supabase Database
            current_time = time.time()
            is_danger = (status == "BAHAYA" or api or asap or suhu >= 40)
            
            # Write immediately on danger status, or space out normal logs every 10 seconds
            if is_danger or (current_time - last_db_write_time >= db_write_interval):
                success = save_to_supabase(suhu, api, asap, status)
                if success:
                    last_db_write_time = current_time
                    
        except serial.SerialException as se:
            logger.error(f"Serial communication error: {se}")
            if ser:
                try:
                    ser.close()
                except:
                    pass
                ser = None
            time.sleep(2)  # Wait before retrying port open
            
        except KeyboardInterrupt:
            logger.info("Stopping Serial Gateway...")
            break
        except Exception as e:
            logger.error(f"Unexpected error in gateway loop: {e}")
            time.sleep(2)
            
    # Cleanup
    if ser:
        ser.close()
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    logger.info("Serial Gateway stopped.")

if __name__ == "__main__":
    main()
