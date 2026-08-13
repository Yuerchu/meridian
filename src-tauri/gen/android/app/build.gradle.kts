import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "cn.yuxiaoqiu.meridian"

    // Prebuilt sherpa-onnx libraries for offline voice input, fetched by
    // scripts/fetch-sherpa-android.sh. A second source directory rather than
    // src/main/jniLibs, which Tauri writes libmeridian_lib.so into — mixing
    // downloaded artefacts with build output there leaves stale .so files
    // nobody can attribute. AGP merges the directories and skips this one when
    // it is absent, so a build without the fetch still succeeds; it just has no
    // speech recognition. Only arm64-v8a is populated: SHERPA_ONNX_LIB_DIR is a
    // single path, so a multi-ABI build would link the others wrongly.
    sourceSets["main"].jniLibs.srcDir("../../../target/sherpa-onnx-android/jniLibs")
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "cn.yuxiaoqiu.meridian"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    val keystorePath = System.getenv("ANDROID_KEYSTORE_FILE")
    val hasReleaseKeystore = keystorePath != null && file(keystorePath).exists()
    if (hasReleaseKeystore) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // No silent debug-signing fallback: a debug-signed "release" APK
            // can't be upgraded later and must never be published. Without a
            // keystore the APK is left unsigned so it cannot be mistaken for
            // a releasable artifact (opt back in with ANDROID_ALLOW_DEBUG_SIGNING=true
            // for local testing).
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else if (System.getenv("ANDROID_ALLOW_DEBUG_SIGNING") == "true") {
                signingConfigs.getByName("debug")
            } else {
                null
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.documentfile:documentfile:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")