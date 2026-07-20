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

  @JvmStatic
  fun launchCamera(reqId: Int): Boolean {
    val activity = MainActivity.instance ?: return false
    activity.launchCameraWithPermission(reqId)
    return true
  }

  @JvmStatic
  fun launchGallery(reqId: Int): Boolean {
    val activity = MainActivity.instance ?: return false
    activity.launchGallery(reqId)
    return true
  }

  @JvmStatic
  fun cleanCameraCache(context: Context) {
    val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000
    context.cacheDir.listFiles()?.forEach { f ->
      if (f.name.startsWith("camera_") && f.lastModified() < cutoff) {
        f.delete()
      }
    }
  }

  @JvmStatic
  fun persistedTreeUris(context: Context): String {
    val arr = JSONArray()
    for (p in context.contentResolver.persistedUriPermissions) {
      if (p.isReadPermission) arr.put(p.uri.toString())
    }
    return arr.toString()
  }

  // ---- SAF file operations ----

  private fun segments(relPath: String): List<String> =
    relPath.split('/').filter { it.isNotEmpty() }

  private data class Doc(val docId: String, val mime: String) {
    fun isDir(): Boolean = mime == DocumentsContract.Document.MIME_TYPE_DIR
  }

  private fun docUri(tree: Uri, docId: String): Uri =
    DocumentsContract.buildDocumentUriUsingTree(tree, docId)

  private fun findChild(context: Context, tree: Uri, parentDocId: String, name: String): Doc? {
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId)
    context.contentResolver.query(
      childrenUri,
      arrayOf(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
      ),
      null, null, null
    )?.use { c ->
      val idIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      while (c.moveToNext()) {
        if (c.getString(nameIdx) == name) {
          return Doc(c.getString(idIdx), c.getString(mimeIdx))
        }
      }
    }
    return null
  }

  private fun resolveDoc(context: Context, treeUri: String, relPath: String): Doc? {
    val tree = Uri.parse(treeUri)
    var docId = DocumentsContract.getTreeDocumentId(tree)
    var mime = DocumentsContract.Document.MIME_TYPE_DIR
    for (seg in segments(relPath)) {
      val child = findChild(context, tree, docId, seg) ?: return null
      docId = child.docId
      mime = child.mime
    }
    return Doc(docId, mime)
  }

  private fun mustResolveDoc(context: Context, treeUri: String, relPath: String): Doc =
    resolveDoc(context, treeUri, relPath)
      ?: throw FileNotFoundException("not found: $relPath")

  private fun queryDisplayName(context: Context, docUri: Uri): String? {
    context.contentResolver.query(
      docUri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
      null, null, null
    )?.use { c ->
      if (c.moveToFirst()) return c.getString(0)
    }
    return null
  }

  @JvmStatic
  fun safRead(context: Context, treeUri: String, relPath: String, maxBytes: Long): String {
    val doc = mustResolveDoc(context, treeUri, relPath)
    if (doc.isDir()) throw IOException("'$relPath' is a directory")
    val tree = Uri.parse(treeUri)
    val uri = docUri(tree, doc.docId)

    // Query file size from provider
    var fileSize: Long? = null
    context.contentResolver.query(
      uri, arrayOf(DocumentsContract.Document.COLUMN_SIZE),
      null, null, null
    )?.use { c ->
      if (c.moveToFirst() && !c.isNull(0)) fileSize = c.getLong(0)
    }

    val stream = context.contentResolver.openInputStream(uri)
      ?: throw IOException("cannot open '$relPath'")
    stream.use { ins ->
      val unlimited = maxBytes <= 0
      val limit = if (unlimited) Long.MAX_VALUE else maxBytes
      val buf = ByteArray(8192)
      val bos = java.io.ByteArrayOutputStream()
      var total = 0L
      var truncated = false
      while (true) {
        val remaining = limit - total
        if (remaining <= 0) { truncated = true; break }
        val toRead = minOf(buf.size.toLong(), remaining).toInt()
        val n = ins.read(buf, 0, toRead)
        if (n < 0) break
        bos.write(buf, 0, n)
        total += n
      }
      val raw = bos.toByteArray()
      // Strict UTF-8 decode
      val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
      val bb = java.nio.ByteBuffer.wrap(raw)
      val content: String = try {
        if (truncated) {
          // truncated: endOfInput=false so partial multi-byte at end is not an error
          val cb = java.nio.CharBuffer.allocate(raw.size)
          val result = decoder.decode(bb, cb, false)
          if (result.isError) throw IOException("not valid UTF-8 (binary file?)")
          cb.flip()
          cb.toString()
        } else {
          decoder.decode(bb).toString()
        }
      } catch (e: java.nio.charset.CharacterCodingException) {
        throw IOException("not valid UTF-8 (binary file?)")
      }
      val o = JSONObject()
      o.put("content", content)
      o.put("truncated", truncated)
      if (fileSize != null) o.put("size", fileSize) else o.put("size", JSONObject.NULL)
      return o.toString()
    }
  }

  @JvmStatic
  fun safWrite(context: Context, treeUri: String, relPath: String, content: String) {
    val segs = segments(relPath)
    if (segs.isEmpty()) throw IOException("cannot write to the directory root")
    val tree = Uri.parse(treeUri)

    // Ensure parent directories exist, creating via DocumentsContract
    var parentDocId = DocumentsContract.getTreeDocumentId(tree)
    for (seg in segs.dropLast(1)) {
      val child = findChild(context, tree, parentDocId, seg)
      parentDocId = when {
        child == null -> {
          val parentUri = docUri(tree, parentDocId)
          val created = DocumentsContract.createDocument(
            context.contentResolver, parentUri,
            DocumentsContract.Document.MIME_TYPE_DIR, seg
          ) ?: throw IOException("cannot create directory '$seg'")
          DocumentsContract.getDocumentId(created)
        }
        child.isDir() -> child.docId
        else -> throw IOException("'$seg' is not a directory")
      }
    }

    val name = segs.last()
    val existing = findChild(context, tree, parentDocId, name)
    val targetUri: Uri
    if (existing != null) {
      if (existing.isDir()) throw IOException("'$name' is a directory")
      targetUri = docUri(tree, existing.docId)
    } else {
      val ext = name.substringAfterLast('.', "")
      val mime = if (ext.isNotEmpty()) {
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())
          ?: "application/octet-stream"
      } else {
        "application/octet-stream"
      }
      val parentUri = docUri(tree, parentDocId)
      val createdUri = DocumentsContract.createDocument(
        context.contentResolver, parentUri, mime, name
      ) ?: throw IOException("cannot create '$name'")
      // Verify display name; some providers uniquify silently
      val actualName = queryDisplayName(context, createdUri)
      if (actualName != null && actualName != name) {
        // Try to rename to the intended name
        try {
          DocumentsContract.renameDocument(context.contentResolver, createdUri, name)
        } catch (_: Exception) {
          // Cleanup and report
          try { DocumentsContract.deleteDocument(context.contentResolver, createdUri) } catch (_: Exception) {}
          throw IOException("provider renamed '$name' to '$actualName'; cannot create file with exact name")
        }
      }
      targetUri = createdUri
    }
    context.contentResolver.openOutputStream(targetUri, "wt")?.use {
      it.write(content.toByteArray(Charsets.UTF_8))
    } ?: throw IOException("cannot open '$name' for writing")
  }

  /** Returns a JSON array of {name, is_dir, size}. */
  @JvmStatic
  fun safList(context: Context, treeUri: String, relPath: String): String {
    val doc = mustResolveDoc(context, treeUri, relPath)
    if (!doc.isDir()) throw IOException("'$relPath' is not a directory")
    val tree = Uri.parse(treeUri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, doc.docId)
    val arr = JSONArray()
    context.contentResolver.query(
      childrenUri,
      arrayOf(
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE
      ),
      null, null, null
    )?.use { c ->
      val nameIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
      val sizeIdx = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
      while (c.moveToNext()) {
        val name = c.getString(nameIdx) ?: continue
        val mime = c.getString(mimeIdx) ?: ""
        val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
        val o = JSONObject()
        o.put("name", name)
        o.put("is_dir", isDir)
        if (!isDir && !c.isNull(sizeIdx)) o.put("size", c.getLong(sizeIdx)) else o.put("size", JSONObject.NULL)
        arr.put(o)
      }
    }
    return arr.toString()
  }

  @JvmStatic
  fun safDelete(context: Context, treeUri: String, relPath: String, recursive: Boolean) {
    if (segments(relPath).isEmpty()) throw IOException("refusing to delete the directory root")
    val doc = mustResolveDoc(context, treeUri, relPath)
    val tree = Uri.parse(treeUri)
    val uri = docUri(tree, doc.docId)
    if (doc.isDir() && !recursive) {
      // Check if directory is empty via cursor count
      val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, doc.docId)
      context.contentResolver.query(
        childrenUri,
        arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID),
        null, null, null
      )?.use { c ->
        if (c.count > 0) throw IOException("directory '$relPath' is not empty (pass recursive: true)")
      }
    }
    if (!DocumentsContract.deleteDocument(context.contentResolver, uri)) {
      throw IOException("failed to delete '$relPath'")
    }
  }

  @JvmStatic
  fun safRename(context: Context, treeUri: String, fromRel: String, toRel: String) {
    val fromSegs = segments(fromRel)
    val toSegs = segments(toRel)
    if (fromSegs.isEmpty()) throw IOException("refusing to move the directory root")
    if (toSegs.isEmpty()) throw IOException("invalid destination")
    if (resolveDoc(context, treeUri, toRel) != null) {
      throw IOException("destination '$toRel' already exists")
    }
    val src = mustResolveDoc(context, treeUri, fromRel)
    val tree = Uri.parse(treeUri)
    var currentUri = docUri(tree, src.docId)

    val fromParent = fromSegs.dropLast(1)
    val toParent = toSegs.dropLast(1)
    // Move first (preserving current name)
    if (fromParent != toParent) {
      val srcParent = if (fromParent.isEmpty()) {
        Doc(DocumentsContract.getTreeDocumentId(tree), DocumentsContract.Document.MIME_TYPE_DIR)
      } else {
        mustResolveDoc(context, treeUri, fromParent.joinToString("/"))
      }
      val dstParent = if (toParent.isEmpty()) {
        Doc(DocumentsContract.getTreeDocumentId(tree), DocumentsContract.Document.MIME_TYPE_DIR)
      } else {
        resolveDoc(context, treeUri, toParent.joinToString("/"))
          ?: throw FileNotFoundException("destination directory does not exist: ${toParent.joinToString("/")}")
      }
      val movedUri = DocumentsContract.moveDocument(
        context.contentResolver,
        currentUri,
        docUri(tree, srcParent.docId),
        docUri(tree, dstParent.docId)
      ) ?: throw IOException("move failed")
      currentUri = movedUri
    }

    // Rename if the file name changed
    if (fromSegs.last() != toSegs.last()) {
      val renamedUri = DocumentsContract.renameDocument(
        context.contentResolver, currentUri, toSegs.last()
      )
      if (renamedUri == null) {
        // Report file's current location
        val actualName = queryDisplayName(context, currentUri) ?: "unknown"
        throw IOException("rename to '${toSegs.last()}' failed; file is at '$actualName' in ${toParent.joinToString("/")}")
      }
      // Verify provider didn't silently uniquify the name
      val actualName = queryDisplayName(context, renamedUri)
      if (actualName != null && actualName != toSegs.last()) {
        throw IOException("provider renamed to '$actualName' instead of '${toSegs.last()}'")
      }
    }
  }

  // ---- Content URI helpers (for attachment upload) ----

  @JvmStatic
  fun contentStat(context: Context, uri: String): String {
    val u = Uri.parse(uri)
    val o = JSONObject()
    context.contentResolver.query(u,
        arrayOf(android.provider.OpenableColumns.DISPLAY_NAME, android.provider.OpenableColumns.SIZE),
        null, null, null)?.use { c ->
      if (c.moveToFirst()) {
        val ni = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
        if (ni >= 0 && !c.isNull(ni)) o.put("name", c.getString(ni))
        val si = c.getColumnIndex(android.provider.OpenableColumns.SIZE)
        if (si >= 0 && !c.isNull(si)) o.put("size", c.getLong(si))
      }
    }
    context.contentResolver.getType(u)?.let { o.put("mime", it) }
    return o.toString()
  }

  @JvmStatic
  fun contentCopy(context: Context, uri: String, destAbsPath: String) {
    val ins = context.contentResolver.openInputStream(Uri.parse(uri))
      ?: throw IOException("cannot open $uri")
    ins.use { s -> java.io.File(destAbsPath).outputStream().use { s.copyTo(it) } }
  }
}
