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
  DETECTION_CONFIDENCE_THRESHOLD: 0.5,
  RECOGNITION_THRESHOLD: 0.72, // Cosine similarity threshold (tuned for Indian demographics)
  SPOOF_THRESHOLD: 0.65,       // Passive liveness threshold
};

export const LIVENESS_CONFIG = {
  CHALLENGE_COUNT: 2,           // How many challenges per auth attempt
  CHALLENGE_TIMEOUT_MS: 5000,  // 5 sec per challenge
  EAR_BLINK_THRESHOLD: 0.21,   // Eye Aspect Ratio — blink detected below this
  EAR_CONSECUTIVE_FRAMES: 2,   // Min frames for valid blink
  SMILE_THRESHOLD: 1.45,       // Lip corner ratio for smile (tuned for outer mouth/eye ratio)
  HEAD_TURN_ANGLE: 20,         // Degrees for left/right turn
  NOD_ANGLE: 15,               // Degrees for nod
  MIN_OPTICAL_FLOW_REAL: 0.15, // Min motion for real face
  MAX_OPTICAL_FLOW_SPOOF: 0.04,// Max motion for static spoof
};

export const QUALITY_CONFIG = {
  MIN_BLUR_SCORE: 30,          // Laplacian variance (relaxed for mobile cameras)
  MIN_BRIGHTNESS: 20,
  MAX_BRIGHTNESS: 240,
  MIN_FACE_SIZE_PX: 50,        // Minimum face width/height in pixels
  FACE_CENTER_TOLERANCE: 0.45, // Face must be within center 45% of frame
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

// ─── Premium Dark Theme ──────────────────────────────────────────────────────
// Carefully curated palette for a high-end security product feel

export const UI_COLORS = {
  // Core palette
  PRIMARY: '#0D0D1A',          // Deep space black
  ACCENT: '#E94560',           // Vibrant crimson
  ACCENT_LIGHT: 'rgba(233,69,96,0.15)',
  SUCCESS: '#00D68F',          // Emerald green
  SUCCESS_LIGHT: 'rgba(0,214,143,0.12)',
  WARNING: '#FFB347',          // Warm amber
  WARNING_LIGHT: 'rgba(255,179,71,0.12)',
  ERROR: '#FF4757',            // Alert red
  ERROR_LIGHT: 'rgba(255,71,87,0.12)',

  // Surfaces
  BACKGROUND: '#08081A',       // Near-black background
  SURFACE: '#12122A',          // Card surface (subtle blue tint)
  SURFACE_ELEVATED: '#1A1A35', // Elevated cards/modals

  // Text
  TEXT_PRIMARY: '#FFFFFF',
  TEXT_SECONDARY: '#6B7199',   // Cool gray-blue
  TEXT_TERTIARY: 'rgba(255,255,255,0.25)',

  // Decorative
  BORDER: 'rgba(255,255,255,0.06)',
  BORDER_ACCENT: 'rgba(233,69,96,0.25)',
  GLOW_ACCENT: 'rgba(233,69,96,0.08)',
  GLOW_SUCCESS: 'rgba(0,214,143,0.08)',
  OVERLAY: 'rgba(8,8,26,0.85)',

  // Gradients (for LinearGradient or as reference)
  GRAD_ACCENT_START: '#E94560',
  GRAD_ACCENT_END: '#C73050',
  GRAD_SURFACE_START: '#15152D',
  GRAD_SURFACE_END: '#0D0D1A',

  // Feature colors (for menu cards)
  CYAN: '#4FC3F7',
  PURPLE: '#B388FF',
  TEAL: '#64FFDA',
};
