package com.sunhub.community

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.sunhub.core.UploadFile
import java.io.File
import java.util.UUID

/** Copy picker grants into private storage so uploads survive the picker closing. */
object MediaFiles {
    fun import(context: Context, uris: List<Uri>, post: Boolean): List<UploadFile> {
        require(uris.size <= if (post) 4 else 3) { if (post) "Choose up to four photos." else "Choose up to three attachments." }
        val resolver = context.contentResolver
        val selected = mutableListOf<UploadFile>()
        try {
            for (uri in uris) {
                val mime = resolver.getType(uri) ?: "application/octet-stream"
                val allowed = listOf("image/jpeg", "image/png", "image/webp", "application/pdf") + if (post) listOf("video/mp4", "video/webm") else emptyList()
                require(mime in allowed) { if (post) "Choose JPG, PNG, WebP, MP4, WebM or PDF files." else "Choose JPG, PNG, WebP or PDF files." }
                require(!post || mime.startsWith("image/") || uris.size == 1) { "Choose up to four photos, or one video or PDF." }
                val limit = (if (!post || mime.startsWith("image/")) 10L else if (mime == "application/pdf") 20L else 100L) * 1024 * 1024
                var name = "Attachment"
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        name = cursor.getString(0).orEmpty().take(200)
                        if (!cursor.isNull(1)) require(cursor.getLong(1) <= limit) { "This file is too large. Maximum ${limit / 1024 / 1024} MB." }
                    }
                }
                val directory = File(context.cacheDir, "uploads").apply { mkdirs() }
                val destination = File(directory, UUID.randomUUID().toString())
                selected += UploadFile(destination.absolutePath, name, mime)
                resolver.openInputStream(uri)?.use { input -> destination.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024); var total = 0L
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        total += count; require(total <= limit) { "This file is too large. Maximum ${limit / 1024 / 1024} MB." }
                        output.write(buffer, 0, count)
                    }
                } } ?: error("Couldn’t read this attachment. Please choose it again.")
            }
            return selected
        } catch (e: Exception) { discard(selected); throw e }
    }
    fun discard(files: List<UploadFile>) { files.forEach { File(it.path).delete() } }
}
