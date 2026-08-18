//! The `Java_*` entry points MainActivity.kt calls back into.
//!
//! The calls that go the other way — SAF file operations, the pickers,
//! permission queries — live in [`meridian_core::android_bridge`]. What is left
//! here is what cannot: an exported symbol belongs beside the activity that
//! names it, and the insets a callback records are read back by a Tauri command
//! and emitted at a window.
#![cfg(target_os = "android")]

use std::sync::Mutex;

use jni::JNIEnv;
use jni::objects::{JObject, JString};
use jni::sys::{jfloat, jint};
use meridian_core::android_bridge::{MediaPickResult, SafPickResult, media_waiters, saf_waiters};

// ---- Window insets ----

static CURRENT_INSETS: Mutex<crate::platform::WindowInsets> = Mutex::new(crate::platform::WindowInsets {
    top: 0.0,
    right: 0.0,
    bottom: 0.0,
    left: 0.0,
    ime_bottom: 0.0,
});

pub fn current_insets() -> crate::platform::WindowInsets {
    *CURRENT_INSETS.lock().unwrap()
}

#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_nativeOnInsetsChanged(
    _env: JNIEnv,
    _this: JObject,
    top: jfloat,
    right: jfloat,
    bottom: jfloat,
    left: jfloat,
    ime_bottom: jfloat,
) {
    let insets = crate::platform::WindowInsets {
        top,
        right,
        bottom,
        left,
        ime_bottom,
    };
    *CURRENT_INSETS.lock().unwrap() = insets;
    if let Some(app) = crate::APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = app.emit("insets-changed", insets);
    }
}

// ---- Media picker (camera / gallery) ----

#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_nativeOnCameraResult(
    mut env: JNIEnv,
    _this: JObject,
    req_id: jint,
    uri: JString,
) {
    let result: MediaPickResult = if uri.is_null() {
        None
    } else {
        env.get_string(&uri).ok().map(Into::into)
    };
    if let Some(tx) = media_waiters().lock().unwrap().remove(&req_id) {
        let _ = tx.send(result);
    }
}

#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_nativeOnGalleryResult(
    mut env: JNIEnv,
    _this: JObject,
    req_id: jint,
    uri: JString,
) {
    let result: MediaPickResult = if uri.is_null() {
        None
    } else {
        env.get_string(&uri).ok().map(Into::into)
    };
    if let Some(tx) = media_waiters().lock().unwrap().remove(&req_id) {
        let _ = tx.send(result);
    }
}

// ---- SAF directory picker ----

/// Called from MainActivity's ActivityResult callback.
#[allow(non_snake_case)]
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_MainActivity_nativeOnSafResult(
    mut env: JNIEnv,
    _this: JObject,
    req_id: jint,
    uri: JString,
    name: JString,
) {
    let result: SafPickResult = if uri.is_null() {
        None
    } else {
        match env.get_string(&uri) {
            Ok(s) => {
                let uri_str: String = s.into();
                let name_str: String = if name.is_null() {
                    "directory".to_string()
                } else {
                    env.get_string(&name)
                        .map(Into::into)
                        .unwrap_or_else(|_| "directory".to_string())
                };
                Some((uri_str, name_str))
            }
            Err(_) => None,
        }
    };
    if let Some(tx) = saf_waiters().lock().unwrap().remove(&req_id) {
        let _ = tx.send(result);
    }
}
