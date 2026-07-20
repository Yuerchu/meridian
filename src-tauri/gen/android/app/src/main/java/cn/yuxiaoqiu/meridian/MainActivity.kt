package cn.yuxiaoqiu.meridian

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.documentfile.provider.DocumentFile
import java.io.File

class MainActivity : TauriActivity() {
  companion object {
    init {
      System.loadLibrary("meridian_lib")
    }
    var instance: MainActivity? = null
  }

  private lateinit var safLauncher: ActivityResultLauncher<Intent>
  private var pendingSafReq: Int = -1

  private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
  private var pendingCameraReq: Int = -1
  private var pendingCameraUri: Uri? = null

  private lateinit var galleryLauncher: ActivityResultLauncher<PickVisualMediaRequest>
  private var pendingGalleryReq: Int = -1

  private lateinit var cameraPermLauncher: ActivityResultLauncher<String>
  private var pendingCameraPermReq: Int = -1

  private external fun initNdkContext(context: android.content.Context)
  external fun nativeOnSafResult(reqId: Int, uri: String?, name: String?)
  external fun nativeOnCameraResult(reqId: Int, uri: String?)
  external fun nativeOnGalleryResult(reqId: Int, uri: String?)
  private external fun nativeOnInsetsChanged(
    top: Float, right: Float, bottom: Float, left: Float, imeBottom: Float)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    initNdkContext(applicationContext)
    super.onCreate(savedInstanceState)
    instance = this
    pendingSafReq = savedInstanceState?.getInt("pendingSafReq", -1) ?: -1
    pendingCameraReq = savedInstanceState?.getInt("pendingCameraReq", -1) ?: -1
    pendingCameraUri = savedInstanceState?.getString("pendingCameraUri")?.let { Uri.parse(it) }
    pendingGalleryReq = savedInstanceState?.getInt("pendingGalleryReq", -1) ?: -1
    pendingCameraPermReq = savedInstanceState?.getInt("pendingCameraPermReq", -1) ?: -1

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

    cameraLauncher = registerForActivityResult(
      ActivityResultContracts.TakePicture()
    ) { success ->
      val reqId = pendingCameraReq
      val uri = pendingCameraUri
      pendingCameraReq = -1
      pendingCameraUri = null
      if (reqId < 0) return@registerForActivityResult
      if (success && uri != null) {
        nativeOnCameraResult(reqId, uri.toString())
      } else {
        nativeOnCameraResult(reqId, null)
      }
    }

    galleryLauncher = registerForActivityResult(
      ActivityResultContracts.PickVisualMedia()
    ) { uri ->
      val reqId = pendingGalleryReq
      pendingGalleryReq = -1
      if (reqId < 0) return@registerForActivityResult
      if (uri != null) {
        nativeOnGalleryResult(reqId, uri.toString())
      } else {
        nativeOnGalleryResult(reqId, null)
      }
    }

    cameraPermLauncher = registerForActivityResult(
      ActivityResultContracts.RequestPermission()
    ) { granted ->
      val reqId = pendingCameraPermReq
      pendingCameraPermReq = -1
      if (reqId < 0) return@registerForActivityResult
      if (granted) {
        launchCamera(reqId)
      } else {
        nativeOnCameraResult(reqId, null)
      }
    }

    setupInsetsListener()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putInt("pendingSafReq", pendingSafReq)
    outState.putInt("pendingCameraReq", pendingCameraReq)
    outState.putString("pendingCameraUri", pendingCameraUri?.toString())
    outState.putInt("pendingGalleryReq", pendingGalleryReq)
    outState.putInt("pendingCameraPermReq", pendingCameraPermReq)
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

  private fun launchCamera(reqId: Int) {
    val file = File(cacheDir, "camera_${System.currentTimeMillis()}.jpg")
    val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
    pendingCameraReq = reqId
    pendingCameraUri = uri
    cameraLauncher.launch(uri)
  }

  fun launchCameraWithPermission(reqId: Int) {
    runOnUiThread {
      if (checkSelfPermission(android.Manifest.permission.CAMERA)
          == PackageManager.PERMISSION_GRANTED) {
        launchCamera(reqId)
      } else {
        pendingCameraPermReq = reqId
        cameraPermLauncher.launch(android.Manifest.permission.CAMERA)
      }
    }
  }

  fun launchGallery(reqId: Int) {
    runOnUiThread {
      pendingGalleryReq = reqId
      galleryLauncher.launch(PickVisualMediaRequest(
        ActivityResultContracts.PickVisualMedia.ImageOnly
      ))
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
