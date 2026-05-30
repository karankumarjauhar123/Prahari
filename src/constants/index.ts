// src/constants/index.ts

export const MODEL_CONFIG = {
  // Model file names (place in android/app/src/main/assets/models/ and ios/models/)
  FACE_DETECTION_MODEL: 'yolov8_face_nano_int8.tflite',
  FACE_RECOGNITION_MODEL: 'adaface_mobilone_s0_int8.tflite',
  LIVENESS_PASSIVE_MODEL: 'antispoof_mobilenet_int8.tflite',
  FACE_MESH_MODEL: 'face_mesh_lite.tflite',

  // Inference settings
  INPUT_SIZE: 112,              // AdaFace input: 112x112
  DETECTION_INPUT_SIZE: 320,   // YOLOv8-face nano input
  EMBEDDING_DIM: 128,
  DETECTION_CONFIDENCE_THRESHOLD: 0.7,
  RECOGNITION_THRESHOLD: 0.72, // Cosine similarity threshold (tuned for Indian demographics)
  SPOOF_THRESHOLD: 0.65,       // Passive liveness threshold
};

export const LIVENESS_CONFIG = {
  CHALLENGE_COUNT: 2,           // How many challenges per auth attempt
  CHALLENGE_TIMEOUT_MS: 5000,  // 5 sec per challenge
  EAR_BLINK_THRESHOLD: 0.21,   // Eye Aspect Ratio — blink detected below this
  EAR_CONSECUTIVE_FRAMES: 2,   // Min frames for valid blink
  SMILE_THRESHOLD: 0.38,       // Lip corner ratio for smile
  HEAD_TURN_ANGLE: 20,         // Degrees for left/right turn
  NOD_ANGLE: 15,               // Degrees for nod
  MIN_OPTICAL_FLOW_REAL: 0.15, // Min motion for real face
  MAX_OPTICAL_FLOW_SPOOF: 0.04,// Max motion for static spoof
};

export const QUALITY_CONFIG = {
  MIN_BLUR_SCORE: 80,          // Laplacian variance
  MIN_BRIGHTNESS: 35,
  MAX_BRIGHTNESS: 220,
  MIN_FACE_SIZE_PX: 80,        // Minimum face width/height in pixels
  FACE_CENTER_TOLERANCE: 0.3,  // Face must be within center 30% of frame
};

export const DB_CONFIG = {
  DATABASE_NAME: 'prahari_vault.db',
  DATABASE_VERSION: 1,
  ENCRYPTION_KEY_ALIAS: 'prahari_db_key_v1',
};

export const AWS_CONFIG = {
  REGION: 'ap-south-1',        // Mumbai region for India
  BUCKET_NAME: 'datalake-attendance-sync',
  USER_POOL_ID: 'YOUR_USER_POOL_ID',
  USER_POOL_CLIENT_ID: 'YOUR_CLIENT_ID',
  IDENTITY_POOL_ID: 'YOUR_IDENTITY_POOL_ID',
};

export const UI_COLORS = {
  PRIMARY: '#1A1A2E',
  ACCENT: '#E94560',
  SUCCESS: '#00C897',
  WARNING: '#FFB347',
  ERROR: '#FF4757',
  BACKGROUND: '#0F0F1A',
  SURFACE: '#1E1E30',
  TEXT_PRIMARY: '#FFFFFF',
  TEXT_SECONDARY: '#8888AA',
  OVERLAY: 'rgba(0,0,0,0.6)',
};
