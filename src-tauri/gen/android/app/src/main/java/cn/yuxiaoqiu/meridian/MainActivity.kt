package cn.yuxiaoqiu.meridian

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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

  private external fun initNdkContext(context: android.content.Context)
  external fun nativeOnSafResult(reqId: Int, uri: String?, name: String?)
  private external fun nativeOnInsetsChanged(
    top: Float, right: Float, bottom: Float, left: Float, imeBottom: Float)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
    instance = this
    pendingSafReq = savedInstanceState?.getInt("pendingSafReq", -1) ?: -1

    safLauncher = registerForActivityResult(
      ActivityResultContracts.StartActivityForResult()
    ) { result ->
      val reqId = pendingSafReq
      pendingSafReq = -1
      if (reqId < 0) return@registerForActivityResult
      val uri = result.data?.data
      if (result.resultCode == RESULT_OK && uri != null) {
        try {
          contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
          )
        } catch (_: SecurityException) {
          nativeOnSafResult(reqId, null, null)
          return@registerForActivityResult
        }
        Thread {
          val name = try { DocumentFile.fromTreeUri(this, uri)?.name } catch (_: Exception) { null }
          nativeOnSafResult(reqId, uri.toString(), name ?: "directory")
        }.start()
      } else {
        nativeOnSafResult(reqId, null, null)
      }
    }

    setupInsetsListener()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putInt("pendingSafReq", pendingSafReq)
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

  private fun setupInsetsListener() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      val d = resources.displayMetrics.density
      val imeExtra = maxOf(0f, (ime.bottom - bars.bottom) / d)
      nativeOnInsetsChanged(
        bars.top / d, bars.right / d, bars.bottom / d, bars.left / d, imeExtra)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
