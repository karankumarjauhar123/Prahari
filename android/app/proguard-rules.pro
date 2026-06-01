# PRAHARI Hackathon - aggressive release size optimization

# TensorFlow Lite / native inference
-keep class org.tensorflow.lite.** { *; }
-dontwarn org.tensorflow.**

# React Native libraries ship their own consumer ProGuard rules. Avoid keeping
# all RN classes here, otherwise R8 cannot shrink unused bridge/codegen paths.
-dontwarn com.facebook.**

# General
-keepattributes *Annotation*
-keep public class * extends java.lang.Exception

# Aggressive optimizations
-optimizationpasses 5
-allowaccessmodification
-repackageclasses ''
-mergeinterfacesaggressively
