//! JNI bridge to the Android side (FileBridge.kt / MainActivity.kt).
//! Only compiled on Android. SAF file operations and permission queries live here.
//!
//! ndk-context is initialized by Tauri's tao android binding before any of
//! these functions can be reached (they are only called from IPC commands or
//! tool execution, both of which require the app to be running).
#![cfg(target_os = "android")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Mutex, OnceLock};

use jni::objects::{JClass, JObject, JString, JValue};
use jni::sys::jint;
use jni::JNIEnv;
use tokio::sync::oneshot;

const BRIDGE_CLASS: &str = "cn.yuxiaoqiu.meridian.FileBridge";

use jni::objects::GlobalRef;

static BRIDGE_REF: OnceLock<GlobalRef> = OnceLock::new();

/// Get the JavaVM via ndk-context.
fn java_vm() -> Result<jni::JavaVM, String> {
    let ctx = ndk_context::android_context();
    unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("failed to get JavaVM: {e}"))
}

/// Attach to the JVM and run `f` with the JNI env and the application context.
/// Pending Java exceptions are converted into Err strings.
/// Uses `attach_current_thread_permanently` to avoid the GlobalRef-drop-on-
/// detached-thread warning that `AttachGuard` causes with jni 0.21.
fn with_env<T>(
    f: impl FnOnce(&mut JNIEnv, &JObject) -> Result<T, jni::errors::Error>,
) -> Result<T, String> {
    let vm = java_vm()?;
    let mut env = vm
        .attach_current_thread_permanently()
        .map_err(|e| format!("failed to attach JNI thread: {e}"))?;
    let ctx = ndk_context::android_context();
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    match f(&mut env, &context) {
        Ok(v) => Ok(v),
        Err(jni::errors::Error::JavaException) => Err(describe_exception(&mut env)),
        Err(e) => Err(format!("JNI error: {e}")),
    }
}

fn describe_exception(env: &mut JNIEnv) -> String {
    let Ok(throwable) = env.exception_occurred() else {
        return "Java exception (no details)".to_string();
    };
    let _ = env.exception_clear();
    if let Ok(msg) = env.call_method(&throwable, "toString", "()Ljava/lang/String;", &[]) {
        if let Ok(obj) = msg.l() {
            if let Ok(s) = env.get_string(&JString::from(obj)) {
                return s.into();
            }
        }
    }
    "Java exception (no details)".to_string()
}

/// Load the FileBridge class once and cache it as a GlobalRef.
/// Subsequent calls return the cached reference.
fn bridge_class<'l>(env: &mut JNIEnv<'l>, context: &JObject) -> Result<JClass<'l>, jni::errors::Error> {
    let global = BRIDGE_REF.get_or_init(|| {
        let loader = env
            .call_method(context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
            .unwrap()
            .l()
            .unwrap();
        let class_name = env.new_string(BRIDGE_CLASS).unwrap();
        let cls = env
            .call_method(
                &loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&class_name)],
            )
            .unwrap()
            .l()
            .unwrap();
        env.new_global_ref(&cls).unwrap()
    });
    // Reinterpret the GlobalRef as a local JClass scoped to this env
    let local = env.new_local_ref(global.as_obj())?;
    Ok(JClass::from(local))
}

pub fn is_manage_storage_granted() -> Result<bool, String> {
    with_env(|env, context| {
        let cls = bridge_class(env, context)?;
        env.call_static_method(
            &cls,
            "isManageStorageGranted",
            "(Landroid/content/Context;)Z",
            &[JValue::Object(context)],
        )?
        .z()
    })
}

pub fn open_manage_storage_settings() -> Result<(), String> {
    with_env(|env, context| {
        let cls = bridge_class(env, context)?;
        env.call_static_method(
            &cls,
            "openManageStorageSettings",
            "(Landroid/content/Context;)V",
            &[JValue::Object(context)],
        )?;
        Ok(())
    })
}

// ---- SAF directory picker ----

type SafPickResult = Option<(String, String)>; // (tree_uri, display_name), None = cancelled

static SAF_WAITERS: OnceLock<Mutex<HashMap<i32, oneshot::Sender<SafPickResult>>>> = OnceLock::new();
static NEXT_SAF_REQ: AtomicI32 = AtomicI32::new(1);

fn saf_waiters() -> &'static Mutex<HashMap<i32, oneshot::Sender<SafPickResult>>> {
    SAF_WAITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Launch the system directory picker. Resolves to None if the user cancels.
pub async fn pick_directory() -> Result<SafPickResult, String> {
    let req_id = NEXT_SAF_REQ.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    saf_waiters().lock().unwrap().insert(req_id, tx);

    let launched = with_env(|env, context| {
        let cls = bridge_class(env, context)?;
        env.call_static_method(
            &cls,
            "launchDirectoryPicker",
            "(I)Z",
            &[JValue::Int(req_id)],
        )?
        .z()
    });
    match launched {
        Ok(true) => {}
        Ok(false) => {
            saf_waiters().lock().unwrap().remove(&req_id);
            return Err("no active window to show the directory picker".to_string());
        }
        Err(e) => {
            saf_waiters().lock().unwrap().remove(&req_id);
            return Err(e);
        }
    }

    rx.await
        .map_err(|_| "directory picker closed unexpectedly".to_string())
}

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
        let uri_str: String = match env.get_string(&uri) {
            Ok(s) => s.into(),
            Err(_) => return,
        };
        let name_str: String = if name.is_null() {
            "directory".to_string()
        } else {
            env.get_string(&name).map(Into::into).unwrap_or_else(|_| "directory".to_string())
        };
        Some((uri_str, name_str))
    };
    if let Some(tx) = saf_waiters().lock().unwrap().remove(&req_id) {
        let _ = tx.send(result);
    }
}

/// Release a persisted SAF grant when the user removes an authorized directory.
pub fn release_persisted_uri(tree_uri: &str) -> Result<(), String> {
    with_env(|env, context| {
        let resolver = env
            .call_method(context, "getContentResolver", "()Landroid/content/ContentResolver;", &[])?
            .l()?;
        let uri_str = env.new_string(tree_uri)?;
        let uri = env
            .call_static_method(
                "android/net/Uri",
                "parse",
                "(Ljava/lang/String;)Landroid/net/Uri;",
                &[JValue::Object(&uri_str)],
            )?
            .l()?;
        // FLAG_GRANT_READ_URI_PERMISSION | FLAG_GRANT_WRITE_URI_PERMISSION = 0x1 | 0x2
        env.call_method(
            &resolver,
            "releasePersistableUriPermission",
            "(Landroid/net/Uri;I)V",
            &[JValue::Object(&uri), JValue::Int(3)],
        )?;
        Ok(())
    })
}

// ---- SAF file operations (blocking JNI wrapped in spawn_blocking) ----

fn call_saf_string(
    method: &'static str,
    sig: &'static str,
    args: Vec<String>,
) -> Result<String, String> {
    with_env(|env, context| {
        let cls = bridge_class(env, context)?;
        let jstrings: Vec<JString> = args
            .iter()
            .map(|a| env.new_string(a))
            .collect::<Result<_, _>>()?;
        let mut jargs: Vec<JValue> = vec![JValue::Object(context)];
        jargs.extend(jstrings.iter().map(|s| JValue::Object(s)));
        let result = env.call_static_method(&cls, method, sig, &jargs)?;
        let obj = JString::from(result.l()?);
        let s = env.get_string(&obj)?;
        Ok(s.into())
    })
}

pub async fn saf_read(tree_uri: &str, rel: &str) -> Result<String, String> {
    let (tree, rel) = (tree_uri.to_string(), rel.to_string());
    tokio::task::spawn_blocking(move || {
        call_saf_string(
            "safRead",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            vec![tree, rel],
        )
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

pub async fn saf_write(tree_uri: &str, rel: &str, content: &str) -> Result<(), String> {
    let (tree, rel, content) = (tree_uri.to_string(), rel.to_string(), content.to_string());
    tokio::task::spawn_blocking(move || {
        with_env(|env, context| {
            let cls = bridge_class(env, context)?;
            let tree = env.new_string(&tree)?;
            let rel = env.new_string(&rel)?;
            let content = env.new_string(&content)?;
            env.call_static_method(
                &cls,
                "safWrite",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(context),
                    JValue::Object(&tree),
                    JValue::Object(&rel),
                    JValue::Object(&content),
                ],
            )?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

pub async fn saf_list(
    tree_uri: &str,
    rel: &str,
) -> Result<Vec<crate::tools::backend::DirEntry>, String> {
    let (tree, rel) = (tree_uri.to_string(), rel.to_string());
    let json = tokio::task::spawn_blocking(move || {
        call_saf_string(
            "safList",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
            vec![tree, rel],
        )
    })
    .await
    .map_err(|e| format!("task failed: {e}"))??;

    #[derive(serde::Deserialize)]
    struct Entry {
        name: String,
        is_dir: bool,
        size: Option<u64>,
    }
    let entries: Vec<Entry> =
        serde_json::from_str(&json).map_err(|e| format!("invalid listing from bridge: {e}"))?;
    Ok(entries
        .into_iter()
        .map(|e| crate::tools::backend::DirEntry {
            name: e.name,
            is_dir: e.is_dir,
            is_symlink: false,
            size: e.size,
        })
        .collect())
}

pub async fn saf_delete(tree_uri: &str, rel: &str, recursive: bool) -> Result<(), String> {
    let (tree, rel) = (tree_uri.to_string(), rel.to_string());
    tokio::task::spawn_blocking(move || {
        with_env(|env, context| {
            let cls = bridge_class(env, context)?;
            let tree = env.new_string(&tree)?;
            let rel = env.new_string(&rel)?;
            env.call_static_method(
                &cls,
                "safDelete",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Z)V",
                &[
                    JValue::Object(context),
                    JValue::Object(&tree),
                    JValue::Object(&rel),
                    JValue::Bool(recursive as u8),
                ],
            )?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

pub async fn saf_rename(tree_uri: &str, from_rel: &str, to_rel: &str) -> Result<(), String> {
    let (tree, from_rel, to_rel) =
        (tree_uri.to_string(), from_rel.to_string(), to_rel.to_string());
    tokio::task::spawn_blocking(move || {
        with_env(|env, context| {
            let cls = bridge_class(env, context)?;
            let tree = env.new_string(&tree)?;
            let from = env.new_string(&from_rel)?;
            let to = env.new_string(&to_rel)?;
            env.call_static_method(
                &cls,
                "safRename",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
                &[
                    JValue::Object(context),
                    JValue::Object(&tree),
                    JValue::Object(&from),
                    JValue::Object(&to),
                ],
            )?;
            Ok(())
        })
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}
