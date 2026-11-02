package com.sunhub.community

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.graphics.Rect
import android.media.ExifInterface
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.sunhub.core.UploadFile
import java.io.File
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal enum class PhotoPurpose {
    Profile,
    Cover,
    Post,
}

/** Shared preview/export geometry. Focal coordinates stay in image space. */
internal object PhotoCrop {
    fun bounds(width: Int, height: Int, aspect: Float, zoom: Float, x: Float, y: Float): Rect {
        require(width > 0 && height > 0 && aspect.isFinite() && aspect > 0)
        val cropWidth =
            (min(width.toFloat(), height * aspect) / zoom.coerceIn(1f, 4f))
                .roundToInt()
                .coerceIn(1, width)
        val cropHeight = (cropWidth / aspect).roundToInt().coerceIn(1, height)
        val left =
            (x.coerceIn(0f, 1f) * width - cropWidth / 2f)
                .roundToInt()
                .coerceIn(0, width - cropWidth)
        val top =
            (y.coerceIn(0f, 1f) * height - cropHeight / 2f)
                .roundToInt()
                .coerceIn(0, height - cropHeight)
        return Rect(left, top, left + cropWidth, top + cropHeight)
    }

    fun decode(file: File): Bitmap {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        require(
            bounds.outWidth > 0 &&
                bounds.outHeight > 0 &&
                bounds.outWidth.toLong() * bounds.outHeight <= 150_000_000L
        ) {
            "This photo could not be opened. Choose another image."
        }
        if (Build.VERSION.SDK_INT >= 28) {
            return ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                decoder.setTargetSampleSize(
                    max(1, ceil(max(info.size.width, info.size.height) / 3072.0).toInt())
                )
            }
        }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > 3072) sample *= 2
        val image =
            BitmapFactory.decodeFile(
                file.path,
                BitmapFactory.Options().apply { inSampleSize = sample },
            ) ?: error("This photo could not be opened. Choose another image.")
        val orientation =
            runCatching {
                    ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1)
                }
                .getOrDefault(1)
        val matrix =
            Matrix().apply {
                when (orientation) {
                    2 -> setScale(-1f, 1f)
                    3 -> setRotate(180f)
                    4 -> {
                        setRotate(180f)
                        postScale(-1f, 1f)
                    }
                    5 -> {
                        setRotate(90f)
                        postScale(-1f, 1f)
                    }
                    6 -> setRotate(90f)
                    7 -> {
                        setRotate(-90f)
                        postScale(-1f, 1f)
                    }
                    8 -> setRotate(-90f)
                }
            }
        return Bitmap.createBitmap(image, 0, 0, image.width, image.height, matrix, true).also {
            if (it !== image) image.recycle()
        }
    }

    fun export(context: Context, original: UploadFile, image: Bitmap, area: Rect): UploadFile {
        val crop = Bitmap.createBitmap(image, area.left, area.top, area.width(), area.height())
        val scale = min(1f, 2048f / max(crop.width, crop.height))
        val output =
            if (scale < 1f)
                Bitmap.createScaledBitmap(
                    crop,
                    max(1, (crop.width * scale).roundToInt()),
                    max(1, (crop.height * scale).roundToInt()),
                    true,
                )
            else crop
        val png = output.hasAlpha() || original.mime == "image/png"
        val extension = if (png) "png" else "jpg"
        val directory = File(context.cacheDir, "uploads").apply { mkdirs() }
        val file = File(directory, UUID.randomUUID().toString())
        try {
            file.outputStream().use {
                check(
                    output.compress(
                        if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                        92,
                        it,
                    )
                )
            }
            require(file.length() <= 10L * 1024 * 1024) {
                "This photo is too large. Choose a smaller crop."
            }
            return UploadFile(
                file.path,
                original.name.substringBeforeLast('.').take(170) + "-crop." + extension,
                if (png) "image/png" else "image/jpeg",
            )
        } catch (error: Exception) {
            file.delete()
            throw error
        } finally {
            if (output !== crop && output !== image) output.recycle()
            if (crop !== image) crop.recycle()
        }
    }
}

/** A decode/export lease prevents disposal from recycling a bitmap while IO still uses it. */
private class CropBitmapOwner {
    private var bitmap: Bitmap? = null
    private var users = 0
    private var disposed = false

    @Synchronized
    fun install(value: Bitmap): Boolean {
        if (disposed) {
            value.recycle()
            return false
        }
        bitmap = value
        return true
    }

    @Synchronized
    fun acquire(): Bitmap? {
        if (disposed) return null
        val value = bitmap ?: return null
        users++
        return value
    }

    @Synchronized
    fun release() {
        users--
        if (disposed && users == 0) {
            bitmap?.recycle()
            bitmap = null
        }
    }

    @Synchronized
    fun dispose() {
        disposed = true
        if (users == 0) {
            bitmap?.recycle()
            bitmap = null
        }
    }
}

/** Returns a new private upload file. The caller retains ownership of the original. */
@Composable
internal fun PhotoAdjuster(
    file: UploadFile,
    purpose: PhotoPurpose,
    onCancel: () -> Unit,
    onUse: (UploadFile) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var image by remember(file.path) { mutableStateOf<Bitmap?>(null) }
    val owner = remember(file.path) { CropBitmapOwner() }
    var error by remember(file.path) { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var ratio by
        rememberSaveable(file.path) {
            mutableStateOf(
                if (purpose == PhotoPurpose.Profile) "1:1"
                else if (purpose == PhotoPurpose.Cover) "4:5" else "Original"
            )
        }
    var zoom by rememberSaveable(file.path) { mutableFloatStateOf(1f) }
    var focusX by rememberSaveable(file.path) { mutableFloatStateOf(0.5f) }
    var focusY by rememberSaveable(file.path) { mutableFloatStateOf(0.5f) }
    LaunchedEffect(file.path) {
        var decoded: Bitmap? = null
        try {
            withContext(Dispatchers.IO) { PhotoCrop.decode(File(file.path)).also { decoded = it } }
            val value = decoded!!
            decoded = null
            if (owner.install(value)) image = value
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (e: Exception) {
            error = e.message ?: "Couldn’t open this photo."
        } finally {
            decoded?.recycle()
        }
    }
    DisposableEffect(owner) { onDispose { owner.dispose() } }
    val bitmap = image
    val aspect =
        when (ratio) {
            "1:1" -> 1f
            "4:5" -> 0.8f
            else -> if (bitmap != null) bitmap.width.toFloat() / bitmap.height else 1f
        }
    fun reset() {
        zoom = 1f
        focusX = 0.5f
        focusY = 0.5f
    }
    fun shift(dx: Float, dy: Float) {
        val b = bitmap ?: return
        val area = PhotoCrop.bounds(b.width, b.height, aspect, zoom, focusX, focusY)
        val next =
            PhotoCrop.bounds(
                b.width,
                b.height,
                aspect,
                zoom,
                focusX + dx * area.width() / b.width,
                focusY + dy * area.height() / b.height,
            )
        focusX = next.exactCenterX() / b.width
        focusY = next.exactCenterY() / b.height
    }
    Dialog(
        onDismissRequest = { if (!saving) onCancel() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            Modifier.fillMaxSize().systemBarsPadding().imePadding().testTag("photo-adjuster"),
            color = Color.White,
        ) {
            Column(Modifier.widthIn(max = 720.dp).fillMaxSize().padding(horizontal = 16.dp)) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 64.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onCancel, enabled = !saving) {
                        Icon(Icons.Outlined.Close, "Cancel photo adjustment")
                    }
                    Text(
                        "Adjust photo",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    TextButton(
                        enabled = bitmap != null && !saving,
                        onClick = {
                            saving = true
                            scope.launch {
                                val b = owner.acquire() ?: return@launch
                                var exported: UploadFile? = null
                                var transferred = false
                                try {
                                    val area =
                                        PhotoCrop.bounds(
                                            b.width,
                                            b.height,
                                            aspect,
                                            zoom,
                                            focusX,
                                            focusY,
                                        )
                                    withContext(Dispatchers.IO) {
                                        PhotoCrop.export(context, file, b, area).also {
                                            exported = it
                                        }
                                    }
                                    onUse(exported!!)
                                    transferred = true
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (e: Exception) {
                                    error = e.message ?: "Couldn’t prepare this photo."
                                } finally {
                                    if (!transferred)
                                        exported?.let { MediaFiles.discard(listOf(it)) }
                                    owner.release()
                                    saving = false
                                }
                            }
                        },
                    ) {
                        if (saving)
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Text("Use photo")
                    }
                }
                Box(
                    Modifier.fillMaxWidth()
                        .weight(1f)
                        .background(Color(0xFF203342), RoundedCornerShape(24.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    if (bitmap == null && error == null) CircularProgressIndicator()
                    if (bitmap != null) {
                        val rendered = remember(bitmap) { bitmap.asImageBitmap() }
                        Canvas(
                            Modifier.fillMaxSize()
                                .testTag("photo-crop-preview")
                                .semantics {
                                    contentDescription =
                                        "Photo crop preview. Drag to position and pinch to zoom."
                                    customActions =
                                        listOf(
                                            CustomAccessibilityAction("Move crop left") {
                                                shift(-0.1f, 0f)
                                                true
                                            },
                                            CustomAccessibilityAction("Move crop right") {
                                                shift(0.1f, 0f)
                                                true
                                            },
                                            CustomAccessibilityAction("Move crop up") {
                                                shift(0f, -0.1f)
                                                true
                                            },
                                            CustomAccessibilityAction("Move crop down") {
                                                shift(0f, 0.1f)
                                                true
                                            },
                                        )
                                }
                                .pointerInput(bitmap, aspect, saving) {
                                    detectTransformGestures { centroid, pan, scale, _ ->
                                        if (!saving) {
                                            val frameWidth =
                                                min(size.width - 24f, (size.height - 24f) * aspect)
                                                    .coerceAtLeast(1f)
                                            val frameHeight = frameWidth / aspect
                                            val previous =
                                                PhotoCrop.bounds(
                                                    bitmap.width,
                                                    bitmap.height,
                                                    aspect,
                                                    zoom,
                                                    focusX,
                                                    focusY,
                                                )
                                            val fx =
                                                ((centroid.x - (size.width - frameWidth) / 2) /
                                                        frameWidth)
                                                    .coerceIn(0f, 1f)
                                            val fy =
                                                ((centroid.y - (size.height - frameHeight) / 2) /
                                                        frameHeight)
                                                    .coerceIn(0f, 1f)
                                            val nextZoom = (zoom * scale).coerceIn(1f, 4f)
                                            val next =
                                                PhotoCrop.bounds(
                                                    bitmap.width,
                                                    bitmap.height,
                                                    aspect,
                                                    nextZoom,
                                                    focusX,
                                                    focusY,
                                                )
                                            val x =
                                                (previous.left + fx * previous.width() -
                                                    fx * next.width() + next.width() / 2f -
                                                    pan.x * previous.width() / frameWidth) /
                                                    bitmap.width
                                            val y =
                                                (previous.top + fy * previous.height() -
                                                    fy * next.height() + next.height() / 2f -
                                                    pan.y * previous.height() / frameHeight) /
                                                    bitmap.height
                                            val bounded =
                                                PhotoCrop.bounds(
                                                    bitmap.width,
                                                    bitmap.height,
                                                    aspect,
                                                    nextZoom,
                                                    x,
                                                    y,
                                                )
                                            zoom = nextZoom
                                            focusX = bounded.exactCenterX() / bitmap.width
                                            focusY = bounded.exactCenterY() / bitmap.height
                                        }
                                    }
                                }
                        ) {
                            val width =
                                min(size.width - 24f, (size.height - 24f) * aspect)
                                    .coerceAtLeast(1f)
                            val height = width / aspect
                            val offset =
                                Offset((size.width - width) / 2, (size.height - height) / 2)
                            val area =
                                PhotoCrop.bounds(
                                    bitmap.width,
                                    bitmap.height,
                                    aspect,
                                    zoom,
                                    focusX,
                                    focusY,
                                )
                            drawRect(Color.White, offset, Size(width, height))
                            drawImage(
                                rendered,
                                IntOffset(area.left, area.top),
                                IntSize(area.width(), area.height()),
                                IntOffset(offset.x.roundToInt(), offset.y.roundToInt()),
                                IntSize(
                                    width.roundToInt().coerceAtLeast(1),
                                    height.roundToInt().coerceAtLeast(1),
                                ),
                            )
                            drawRect(
                                Color.White.copy(alpha = 0.85f),
                                offset,
                                Size(width, height),
                                style = Stroke(1.dp.toPx()),
                            )
                            for (line in 1..2) {
                                drawLine(
                                    Color.White.copy(alpha = 0.35f),
                                    offset + Offset(width * line / 3, 0f),
                                    offset + Offset(width * line / 3, height),
                                    1.dp.toPx(),
                                )
                                drawLine(
                                    Color.White.copy(alpha = 0.35f),
                                    offset + Offset(0f, height * line / 3),
                                    offset + Offset(width, height * line / 3),
                                    1.dp.toPx(),
                                )
                            }
                        }
                    }
                }
                if (error != null)
                    Text(
                        error!!,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                Row(
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    val options =
                        if (purpose == PhotoPurpose.Profile) listOf("1:1")
                        else if (purpose == PhotoPurpose.Cover) listOf("4:5", "1:1")
                        else listOf("Original", "4:5", "1:1")
                    options.forEach { option ->
                        FilterChip(
                            selected = ratio == option,
                            onClick = {
                                ratio = option
                                reset()
                            },
                            enabled = !saving,
                            label = { Text(option) },
                            modifier = Modifier.padding(horizontal = 4.dp).heightIn(min = 48.dp),
                        )
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.ZoomOut, null)
                    Slider(
                        value = zoom,
                        onValueChange = { zoom = it },
                        valueRange = 1f..4f,
                        enabled = bitmap != null && !saving,
                        modifier =
                            Modifier.weight(1f).padding(horizontal = 12.dp).semantics {
                                contentDescription = "Photo zoom"
                            },
                    )
                    Icon(Icons.Outlined.ZoomIn, null)
                    TextButton(onClick = { reset() }, enabled = !saving) { Text("Reset") }
                }
                Text(
                    "Drag to position · Pinch to zoom",
                    color = Muted,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 16.dp),
                )
            }
        }
    }
}
