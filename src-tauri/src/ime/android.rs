//! The keyboard's standing with the system, asked of `ImeBridge.kt`.
//!
//! Whether the keyboard is enabled and whether it is the one in use are
//! Android's answers, not files the keyboard writes, so they are asked for
//! each time the settings page looks. The two actions — the system's keyboard
//! settings, the keyboard picker — are the only ways Android allows an app to
//! get itself enabled and selected; neither can be done on the person's
//! behalf.
//!
//! Same shape as `meridian_core::android_bridge`, whose JNI helpers are
//! private to it: attach, load the class through the app's class loader (a
//! native thread's `FindClass` sees only the system's), call a static method.

use jni::JNIEnv;
use jni::objects::{JClass, JObject, JString, JValue};

const BRIDGE_CLASS: &str = "cn.yuxiaoqiu.meridian.ImeBridge";

fn with_env<T>(f: impl FnOnce(&mut JNIEnv, &JObject, &JClass) -> jni::errors::Result<T>) -> Result<T, String> {
    let ctx = ndk_context::android_context();
    // SAFETY: ndk-context was initialised by `initNdkContext` with the VM
    // pointer Android passed to MainActivity; it outlives the process.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| format!("JavaVM: {e}"))?;
    let mut env = vm
        .attach_current_thread_permanently()
        .map_err(|e| format!("attach: {e}"))?;
    // SAFETY: a global reference held by ndk-context for the process's life.
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let outcome = env.with_local_frame(16, |env| {
        let loader = env
            .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
            .l()?;
        let name = env.new_string(BRIDGE_CLASS)?;
        let class = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )?
            .l()?;
        let class = JClass::from(class);
        Ok(f(env, &context, &class))
    });
    match outcome {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(jni::errors::Error::JavaException)) | Err(jni::errors::Error::JavaException) => {
            Err(describe_exception(&mut env))
        }
        Ok(Err(e)) | Err(e) => Err(format!("JNI: {e}")),
    }
}

fn describe_exception(env: &mut JNIEnv) -> String {
    let Ok(throwable) = env.exception_occurred() else {
        return "Java exception".into();
    };
    let _ = env.exception_clear();
    env.call_method(&throwable, "toString", "()Ljava/lang/String;", &[])
        .and_then(|v| v.l())
        .and_then(|o| env.get_string(&JString::from(o)).map(String::from))
        .unwrap_or_else(|_| "Java exception".into())
}

fn call_bool(method: &str) -> Result<bool, String> {
    with_env(|env, context, class| {
        env.call_static_method(
            class,
            method,
            "(Landroid/content/Context;)Z",
            &[JValue::Object(context)],
        )?
        .z()
    })
}

fn call_void(method: &str) -> Result<(), String> {
    with_env(|env, context, class| {
        env.call_static_method(
            class,
            method,
            "(Landroid/content/Context;)V",
            &[JValue::Object(context)],
        )?;
        Ok(())
    })
}

/// The keyboard is on the system's list of enabled keyboards.
pub fn is_enabled() -> Result<bool, String> {
    call_bool("isEnabled")
}

/// The keyboard is the one text fields get now.
pub fn is_current() -> Result<bool, String> {
    call_bool("isCurrent")
}

/// Opens the system's keyboard settings, where it can be switched on.
pub fn open_settings() -> Result<(), String> {
    call_void("openSettings")
}

/// Shows the system's keyboard picker.
pub fn show_picker() -> Result<(), String> {
    call_void("showPicker")
}
