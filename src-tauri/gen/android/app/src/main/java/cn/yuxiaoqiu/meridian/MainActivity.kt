package cn.yuxiaoqiu.meridian

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.documentfile.provider.DocumentFile

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("meridian_lib")
    }
    var instance: MainActivity? = null
  }

  private lateinit var safLauncher: ActivityResultLauncher<Intent>
  private var pendingSafReq: Int = -1

  /** Initialize ndk-context + android-keyring. Must be called before any Rust
   *  code touches the Android keystore. Implemented in lib.rs. */
  private external fun initNdkContext(context: android.content.Context)

  /** Implemented in Rust: src/android_bridge.rs (nativeOnSafResult). */
  external fun nativeOnSafResult(reqId: Int, uri: String?, name: String?)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
    instance = this
    safLauncher = registerForActivityResult(
      ActivityResultContracts.StartActivityForResult()
    ) { result ->
      val reqId = pendingSafReq
      pendingSafReq = -1
      if (reqId < 0) return@registerForActivityResult
      val uri = result.data?.data
      if (result.resultCode == RESULT_OK && uri != null) {
        contentResolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        val name = DocumentFile.fromTreeUri(this, uri)?.name ?: "directory"
        nativeOnSafResult(reqId, uri.toString(), name)
      } else {
        nativeOnSafResult(reqId, null, null)
      }
    }
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  fun launchSafPicker(reqId: Int) {
    runOnUiThread {
      pendingSafReq = reqId
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
      intent.addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION
          or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
          or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
      )
      safLauncher.launch(intent)
    }
  }
}
