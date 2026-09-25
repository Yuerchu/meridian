//! The `Java_*` functions `EngineBridge.kt` declares as `external`.
//!
//! Every one runs under `catch_unwind`: a panic here would otherwise take the
//! keyboard's process down, and with it whatever the person was typing into.
//! A panic becomes an `IllegalStateException` and the call's neutral answer;
//! the keyboard catches it and carries on as a plain keyboard.
//!
//! The handle is a `Box<ImeHost>` turned into a `long`. `ImeHost` takes no
//! lock, so the Kotlin side calls it from exactly one thread (`ime-engine`),
//! and calls `nativeDestroy` once, last.
#![allow(non_snake_case)]

use std::panic::AssertUnwindSafe;
use std::ptr::null_mut;
use std::sync::Once;
use std::time::Instant;

use jni::JNIEnv;
use jni::objects::{JClass, JString};
use jni::sys::{JNI_FALSE, JNI_TRUE, jboolean, jint, jlong, jstring};
use meridian_ime_config::ImeDirs;

use crate::ImeHost;
use crate::bridge;

const ILLEGAL_STATE: &str = "java/lang/IllegalStateException";
const ILLEGAL_ARGUMENT: &str = "java/lang/IllegalArgumentException";
const IO: &str = "java/io/IOException";

/// A Java exception to raise instead of returning.
struct Fail {
    class: &'static str,
    message: String,
}

fn fail(class: &'static str, message: impl Into<String>) -> Fail {
    Fail {
        class,
        message: message.into(),
    }
}

/// Runs `f`, turning an error into the exception it names and a panic into an
/// `IllegalStateException`; either way the caller gets `fallback`.
fn guard<T>(env: &mut JNIEnv, fallback: T, f: impl FnOnce(&mut JNIEnv) -> Result<T, Fail>) -> T {
    let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| f(&mut *env)));
    let failure = match outcome {
        Ok(Ok(v)) => return v,
        Ok(Err(e)) => e,
        Err(panic) => {
            let what = panic
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic".into());
            tracing::error!(what, "panic inside the input method");
            fail(ILLEGAL_STATE, format!("input method panicked: {what}"))
        }
    };
    if !env.exception_check().unwrap_or(true) {
        let _ = env.throw_new(failure.class, failure.message);
    }
    fallback
}

fn host<'a>(handle: jlong) -> Result<&'a mut ImeHost, Fail> {
    if handle == 0 {
        return Err(fail(ILLEGAL_STATE, "the engine was not created or is destroyed"));
    }
    // SAFETY: a non-zero handle came from `nativeCreate`'s `Box::into_raw`
    // and has not been passed to `nativeDestroy` (the Kotlin side zeroes its
    // copy first); calls arrive on one thread, so the borrow is exclusive.
    Ok(unsafe { &mut *(handle as *mut ImeHost) })
}

fn string(env: &mut JNIEnv, s: &JString) -> Result<String, Fail> {
    env.get_string(s)
        .map(Into::into)
        .map_err(|e| fail(ILLEGAL_ARGUMENT, e.to_string()))
}

fn optional_string(env: &mut JNIEnv, s: &JString) -> Result<Option<String>, Fail> {
    if s.is_null() {
        Ok(None)
    } else {
        string(env, s).map(Some)
    }
}

fn json_out(env: &mut JNIEnv, value: &impl serde::Serialize) -> Result<jstring, Fail> {
    let text = serde_json::to_string(value).map_err(|e| fail(ILLEGAL_STATE, e.to_string()))?;
    env.new_string(text)
        .map(|s| s.into_raw())
        .map_err(|e| fail(ILLEGAL_STATE, e.to_string()))
}

static LOGGING: Once = Once::new();

/// Opens the data directory (`dataDir/ime`) and returns the handle.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
) -> jlong {
    guard(&mut env, 0, |env| {
        let root = string(env, &data_dir)?;
        let dirs = ImeDirs::new(&root);
        LOGGING.call_once(|| {
            let _ = dirs.ensure();
            let debug = meridian_ime_host::data::load_config(&dirs).debug_log;
            meridian_ime_host::logging::init(&dirs.log_file(), debug);
        });
        let host = ImeHost::open(root).map_err(|e| fail(IO, e.to_string()))?;
        tracing::info!(version = env!("CARGO_PKG_VERSION"), "keyboard engine ready");
        Ok(Box::into_raw(Box::new(host)) as jlong)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeDestroy(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    guard(&mut env, (), |_| {
        if handle != 0 {
            // SAFETY: see `host`; this is the one call that takes it back.
            drop(unsafe { Box::from_raw(handle as *mut ImeHost) });
        }
        Ok(())
    })
}

/// A field gained focus. `package` may be null; `private` is the field's own
/// request not to be learned from. Returns the (empty) frame.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeStartInput(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    package: JString,
    private: jboolean,
) -> jstring {
    guard(&mut env, null_mut(), |env| {
        let package = optional_string(env, &package)?;
        let host = host(handle)?;
        let frame = host.start_input(package.as_deref(), private != JNI_FALSE);
        json_out(env, &frame)
    })
}

/// `"pinyin"`, `"zhuyin"`, `"grid"`, or null for `host.json`'s.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeSetScheme(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    scheme: JString,
) {
    guard(&mut env, (), |env| {
        let name = optional_string(env, &scheme)?;
        let scheme = bridge::scheme(name.as_deref()).map_err(|e| fail(ILLEGAL_ARGUMENT, e))?;
        host(handle)?.set_scheme(scheme);
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeSetSurrounding(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    left: JString,
    right: JString,
) {
    guard(&mut env, (), |env| {
        let left = string(env, &left)?;
        let right = string(env, &right)?;
        host(handle)?.set_surrounding(&left, &right);
        Ok(())
    })
}

/// One key; see [`bridge::key_event`]. Returns the `KeyOutcome` as JSON.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeHandleKey(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    vk: jint,
    ch: jint,
    mods: jint,
    caps_lock: jboolean,
) -> jstring {
    guard(&mut env, null_mut(), |env| {
        let event = bridge::key_event(vk, ch, mods, caps_lock != JNI_FALSE).map_err(|e| fail(ILLEGAL_ARGUMENT, e))?;
        let out = host(handle)?.handle_key(event);
        json_out(env, &out)
    })
}

/// A candidate on the current page was tapped.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeChoose(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    index: jint,
) -> jstring {
    guard(&mut env, null_mut(), |env| {
        let index = usize::try_from(index).map_err(|_| fail(ILLEGAL_ARGUMENT, format!("candidate {index}")))?;
        let out = host(handle)?.choose(index);
        json_out(env, &out)
    })
}

/// Drops the composition. Returns the (empty) frame.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeReset(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jstring {
    guard(&mut env, null_mut(), |env| {
        let frame = host(handle)?.reset();
        json_out(env, &frame)
    })
}

/// Picks up changes Meridian made on disk; true when something was reloaded.
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeRefresh(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jboolean {
    guard(&mut env, JNI_FALSE, |_| {
        Ok(if host(handle)?.refresh(Instant::now()) {
            JNI_TRUE
        } else {
            JNI_FALSE
        })
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeFlush(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    guard(&mut env, (), |_| {
        host(handle)?.flush();
        Ok(())
    })
}

/// The grid's keys; see [`crate::grid_tokens_json`].
#[unsafe(no_mangle)]
pub extern "system" fn Java_cn_yuxiaoqiu_meridian_ime_EngineBridge_nativeGridTokens(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    guard(&mut env, null_mut(), |env| {
        env.new_string(crate::grid_tokens_json())
            .map(|s| s.into_raw())
            .map_err(|e| fail(ILLEGAL_STATE, e.to_string()))
    })
}
