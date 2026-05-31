# android/app/proguard-rules.pro
# PRAHARI Hackathon — Aggressive size optimization

# ─── TensorFlow Lite ─────────────────────────────────────────────────────────
-keep class org.tensorflow.lite.** { *; }
-dontwarn org.tensorflow.**

# ─── SQLCipher ────────────────────────────────────────────────────────────────
-keep class net.sqlcipher.** { *; }
-keep class net.sqlcipher.database.** { *; }

# ─── React Native (minimal keeps) ────────────────────────────────────────────
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.** { *; }
-dontwarn com.facebook.**

# ─── General ──────────────────────────────────────────────────────────────────
-keepattributes *Annotation*
-keep public class * extends java.lang.Exception

# ─── Aggressive optimizations ─────────────────────────────────────────────────
-optimizationpasses 5
-allowaccessmodification
-repackageclasses ''
-mergeinterfacesaggressively
