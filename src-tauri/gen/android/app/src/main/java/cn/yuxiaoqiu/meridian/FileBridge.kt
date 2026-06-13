package cn.yuxiaoqiu.meridian

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import android.webkit.MimeTypeMap
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.io.IOException

/**
 * Static helpers called from Rust via JNI (see src/android_bridge.rs).
 * Loaded through the app context's class loader, so keep everything static.
 * Errors are reported by throwing; the Rust side converts pending Java
 * exceptions into Result::Err strings.
 */
object FileBridge {
  @JvmStatic
  fun isManageStorageGranted(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= 30) {
      Environment.isExternalStorageManager()
    } else {
      context.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }

  @JvmStatic
  fun openManageStorageSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 30) {
      Intent(
        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
        Uri.parse("package:${context.packageName}")
      )
    } else {
      Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:${context.packageName}")
      )
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(intent)
    } catch (e: Exception) {
      // Some OEM ROMs don't handle the per-app URI; fall back to the global page
      val fallback = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
      fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(fallback)
    }
  }

  /** Returns false when no resumed MainActivity is available to launch the picker. */
  @JvmStatic
  fun launchDirectoryPicker(reqId: Int): Boolean {
    val activity = MainActivity.instance ?: return false
    activity.launchSafPicker(reqId)
    return true
  }

  // ---- SAF file operations ----

  private fun tree(context: Context, treeUri: String): DocumentFile =
    DocumentFile.fromTreeUri(context, Uri.parse(treeUri))
      ?: throw IllegalArgumentException("invalid tree URI: $treeUri")

  private fun segments(relPath: String): List<String> =
    relPath.split('/').filter { it.isNotEmpty() }

  private fun resolve(context: Context, treeUri: String, relPath: String): DocumentFile? {
    var cur = tree(context, treeUri)
    for (seg in segments(relPath)) {
      cur = cur.findFile(seg) ?: return null
    }
    return cur
  }

  private fun mustResolve(context: Context, treeUri: String, relPath: String): DocumentFile =
    resolve(context, treeUri, relPath)
      ?: throw FileNotFoundException("not found: $relPath")

  @JvmStatic
  fun safRead(context: Context, treeUri: String, relPath: String): String {
    val doc = mustResolve(context, treeUri, relPath)
    if (doc.isDirectory) throw IOException("'$relPath' is a directory")
    context.contentResolver.openInputStream(doc.uri)?.use {
      return it.readBytes().toString(Charsets.UTF_8)
    } ?: throw IOException("cannot open '$relPath'")
  }

  @JvmStatic
  fun safWrite(context: Context, treeUri: String, relPath: String, content: String) {
    val segs = segments(relPath)
    if (segs.isEmpty()) throw IOException("cannot write to the directory root")
    var dir = tree(context, treeUri)
    for (seg in segs.dropLast(1)) {
      val next = dir.findFile(seg)
      dir = when {
        next == null -> dir.createDirectory(seg)
          ?: throw IOException("cannot create directory '$seg'")
        next.isDirectory -> next
        else -> throw IOException("'$seg' is not a directory")
      }
    }
    val name = segs.last()
    val existing = dir.findFile(name)
    val target = when {
      existing == null -> {
        val ext = name.substringAfterLast('.', "")
        val mime = if (ext.isNotEmpty()) {
          MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())
            ?: "application/octet-stream"
        } else {
          "application/octet-stream"
        }
        val created = dir.createFile(mime, name)
          ?: throw IOException("cannot create '$name'")
        // Some providers append an extension based on the MIME type; undo that
        if (created.name != name) created.renameTo(name)
        created
      }
      existing.isDirectory -> throw IOException("'$name' is a directory")
      else -> existing
    }
    context.contentResolver.openOutputStream(target.uri, "wt")?.use {
      it.write(content.toByteArray(Charsets.UTF_8))
    } ?: throw IOException("cannot open '$name' for writing")
  }

  /** Returns a JSON array of {name, is_dir, size}. */
  @JvmStatic
  fun safList(context: Context, treeUri: String, relPath: String): String {
    val doc = mustResolve(context, treeUri, relPath)
    if (!doc.isDirectory) throw IOException("'$relPath' is not a directory")
    val arr = JSONArray()
    for (child in doc.listFiles()) {
      val name = child.name ?: continue
      val o = JSONObject()
      o.put("name", name)
      o.put("is_dir", child.isDirectory)
      if (child.isFile) o.put("size", child.length()) else o.put("size", JSONObject.NULL)
      arr.put(o)
    }
    return arr.toString()
  }

  @JvmStatic
  fun safDelete(context: Context, treeUri: String, relPath: String, recursive: Boolean) {
    if (segments(relPath).isEmpty()) throw IOException("refusing to delete the directory root")
    val doc = mustResolve(context, treeUri, relPath)
    if (doc.isDirectory && !recursive && doc.listFiles().isNotEmpty()) {
      throw IOException("directory '$relPath' is not empty (pass recursive: true)")
    }
    if (!doc.delete()) throw IOException("failed to delete '$relPath'")
  }

  @JvmStatic
  fun safRename(context: Context, treeUri: String, fromRel: String, toRel: String) {
    val fromSegs = segments(fromRel)
    val toSegs = segments(toRel)
    if (fromSegs.isEmpty()) throw IOException("refusing to move the directory root")
    if (toSegs.isEmpty()) throw IOException("invalid destination")
    if (resolve(context, treeUri, toRel) != null) {
      throw IOException("destination '$toRel' already exists")
    }
    val src = mustResolve(context, treeUri, fromRel)

    if (fromSegs.last() != toSegs.last()) {
      if (!src.renameTo(toSegs.last())) throw IOException("rename failed")
    }
    val fromParent = fromSegs.dropLast(1)
    val toParent = toSegs.dropLast(1)
    if (fromParent != toParent) {
      val srcParentDoc = resolve(context, treeUri, fromParent.joinToString("/"))
        ?: throw FileNotFoundException("source directory missing")
      val dstParentDoc = resolve(context, treeUri, toParent.joinToString("/"))
        ?: throw FileNotFoundException("destination directory does not exist: ${toParent.joinToString("/")}")
      DocumentsContract.moveDocument(
        context.contentResolver, src.uri, srcParentDoc.uri, dstParentDoc.uri
      ) ?: throw IOException("move failed")
    }
  }
}
