import os
import json
import ssl
import logging
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize Flask App
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', 'default_secret_key')

# Initialize SocketIO
socketio = SocketIO(app, cors_allowed_origins="*")

# MQTT Configuration
MQTT_BROKER = os.getenv('MQTT_BROKER')
MQTT_PORT = int(os.getenv('MQTT_PORT', 8883))
MQTT_USER = os.getenv('MQTT_USER')
MQTT_PASSWORD = os.getenv('MQTT_PASSWORD')
import random
import string
# Generate a unique client ID to prevent connection conflicts (especially in Flask debug mode)
MQTT_CLIENT_ID = f"flask_fire_bridge_{''.join(random.choices(string.ascii_letters + string.digits, k=6))}"

# Sensor Topics (3 Topics)
SUHU_TOPIC = "Kel6/FireDetector/sensor/suhu"
ASAP_TOPIC = "Kel6/FireDetector/sensor/asap"
API_TOPIC = "Kel6/FireDetector/sensor/api"

# Actuator Topics
BUZZER_TOPIC = "Kel6/FireDetector/actuator/buzzer"

# Global state to keep track of connection status
mqtt_connected = False

# MQTT Callbacks
def on_connect(client, userdata, flags, rc):
    global mqtt_connected
    if rc == 0:
        logger.info("Successfully connected to HiveMQ Cloud MQTT Broker!")
        mqtt_connected = True
        # Subscribe to 3 separate sensor topics
        client.subscribe(SUHU_TOPIC)
        client.subscribe(ASAP_TOPIC)
        client.subscribe(API_TOPIC)
        logger.info(f"Subscribed to topics: {SUHU_TOPIC}, {ASAP_TOPIC}, {API_TOPIC}")
        # Broadcast status update
        socketio.emit('mqtt_status', {'status': 'connected'})
    else:
        logger.error(f"MQTT Connection failed with return code {rc}")
        mqtt_connected = False
        socketio.emit('mqtt_status', {'status': 'disconnected', 'error_code': rc})

def on_disconnect(client, userdata, rc):
    global mqtt_connected
    logger.warning(f"Disconnected from MQTT Broker with return code {rc}")
    mqtt_connected = False
    socketio.emit('mqtt_status', {'status': 'disconnected'})

def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode('utf-8').strip()
        logger.info(f"Received message on {msg.topic}: {payload_str}")
        
        if msg.topic == SUHU_TOPIC:
            temp_val = float(payload_str)
            socketio.emit('telemetry_data', {'temperature': temp_val})
        elif msg.topic == API_TOPIC:
            flame_state = (payload_str in ['1', 'ON', 'true', 'TRUE', 'api', 'terdeteksi', 'TERDETEKSI'])
            socketio.emit('telemetry_data', {'flame': flame_state})
        elif msg.topic == ASAP_TOPIC:
            smoke_state = (payload_str in ['1', 'ON', 'true', 'TRUE', 'asap', 'terdeteksi', 'TERDETEKSI'])
            socketio.emit('telemetry_data', {'smoke': smoke_state})
    except Exception as e:
        logger.error(f"Error handling incoming MQTT message on {msg.topic}: {e}")

# Initialize and Configure MQTT Client
mqtt_client = mqtt.Client(client_id=MQTT_CLIENT_ID, transport="tcp")
mqtt_client.on_connect = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message = on_message

# Set username and password
mqtt_client.username_pw_set(MQTT_USER, MQTT_PASSWORD)

# Set SSL/TLS (HiveMQ Cloud requires TLS connection)
context = ssl.create_default_context()
mqtt_client.tls_set_context(context)

# Start MQTT Connection
try:
    logger.info(f"Connecting to HiveMQ Cloud at {MQTT_BROKER}:{MQTT_PORT}...")
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    mqtt_client.loop_start()  # Starts a background thread to handle MQTT traffic
except Exception as e:
    logger.error(f"Failed to start MQTT connection: {e}")

# Flask Web Routes
@app.route('/')
@app.route('/login')
@app.route('/register')
@app.route('/dashboard')
def index():
    return render_template('index.html')

# Flask SocketIO events to query connection status manually
@socketio.on('get_status')
def handle_get_status():
    global mqtt_connected
    status = 'connected' if mqtt_connected else 'disconnected'
    socketio.emit('mqtt_status', {'status': status})

# REST API Endpoints for Actuator Controls
@app.route('/api/control/buzzer', methods=['POST'])
def control_buzzer():
    try:
        data = request.get_json()
        if not data or 'state' not in data:
            return jsonify({'success': False, 'message': 'Missing parameter: state'}), 400
            
        state = data['state'].upper()
        if state not in ['ON', 'OFF']:
            return jsonify({'success': False, 'message': 'Invalid state. Must be ON or OFF'}), 400
            
        payload = json.dumps({"state": state})
        
        # Publish to MQTT
        result = mqtt_client.publish(BUZZER_TOPIC, payload, qos=1)
        # Wait for publish confirmation
        result.wait_for_publish()
        
        logger.info(f"Published buzzer command: {payload} to {BUZZER_TOPIC}")
        return jsonify({'success': True, 'message': f'Buzzer state set to {state}'})
    except Exception as e:
        logger.error(f"Error publishing buzzer command: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# REST API Endpoint to check MQTT status
@app.route('/api/status', methods=['GET'])
def get_mqtt_status():
    global mqtt_connected
    return jsonify({
        'mqtt_connected': mqtt_connected,
        'broker': MQTT_BROKER,
        'port': MQTT_PORT
    })

if __name__ == '__main__':
    # Run the server
    # 0.0.0.0 allows access from other devices in the local network
    logger.info("Starting Flask-SocketIO app on port 5000...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
