# PRAHARI Hackathon - aggressive release size optimization

# TensorFlow Lite / native inference
-keep class org.tensorflow.lite.** { *; }
-dontwarn org.tensorflow.**

# React Native libraries ship their own consumer ProGuard rules. Avoid keeping
# all RN classes here, otherwise R8 cannot shrink unused bridge/codegen paths.
-dontwarn com.facebook.**

# VisionCamera — keep native camera bridge
-keep class com.mrousavy.camera.** { *; }

# General
-keepattributes *Annotation*
-keep public class * extends java.lang.Exception

# Aggressive optimizations
-optimizationpasses 5
-allowaccessmodification
-repackageclasses ''
-mergeinterfacesaggressively

# Strip debug info and logging from release
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
}

# Remove unused Kotlin metadata
-dontwarn kotlin.**
-dontwarn kotlinx.**
-assumenosideeffects class kotlin.jvm.internal.Intrinsics {
    public static void checkNotNullParameter(...);
    public static void checkNotNullExpressionValue(...);
    public static void checkExpressionValueIsNotNull(...);
    public static void checkParameterIsNotNull(...);
    public static void checkReturnedValueIsNotNull(...);
}
