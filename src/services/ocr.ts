/**
 * OCR Service — Extract text from images via OCR.space API
 *
 * Free tier: 25,000 requests/month
 * Supports: JPG, PNG, GIF, BMP, TIFF, PDF
 * Latency: ~1-3 seconds
 *
 * Engine selection:
 * - Engine 1: Fastest, good for digital text (screenshots)
 * - Engine 2: Best for noisy backgrounds (photos of receipts)
 * - Engine 3: Best for tables and handwriting
 */

export interface OCRResult {
  success: boolean;
  text: string;
  engine: string;
  confidence: number;
  errorMessage?: string;
}

/**
 * Extract text from image using OCR.space API
 *
 * @param imageBase64 - Base64-encoded image data (without prefix)
 * @param apiKey - OCR.space API key
 * @param engine - OCR engine to use (1, 2, or 3). Default: 2
 */
export async function extractTextFromImage(
  imageBase64: string,
  apiKey: string,
  engine: string = "2"
): Promise<OCRResult> {
  const startTime = Date.now();

  try {
    const formData = new FormData();
    formData.append("base64Image", `data:image/jpeg;base64,${imageBase64}`);
    formData.append("language", "eng");
    formData.append("isTable", "true");       // Preserve table layout (penting untuk struk)
    formData.append("OCREngine", engine);
    formData.append("scale", "true");          // Upscale low-res images
    formData.append("isCreateSearchablePdf", "false");

    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      body: formData,
      headers: {
        apikey: apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`OCR API HTTP ${response.status}`);
    }

    const result: any = await response.json();
    const elapsed = Date.now() - startTime;

    console.log(`[OCR] Engine ${engine}, ${elapsed}ms, exit code: ${result.OCRExitCode}`);

    // OCRExitCode: 1 = success, 2 = partially parsed, 3+ = error
    if (result.OCRExitCode === 1 || result.OCRExitCode === 2) {
      const parsedText = result.ParsedResults
        ?.map((r: any) => r.ParsedText)
        .join("\n")
        .trim();

      if (!parsedText || parsedText.length === 0) {
        return {
          success: false,
          text: "",
          engine,
          confidence: 0,
          errorMessage: "Tidak ada teks yang terdeteksi di gambar.",
        };
      }

      // Average confidence across results
      const avgConfidence = result.ParsedResults
        ?.reduce((sum: number, r: any) => {
          const textOverlay = r.TextOverlay;
          if (textOverlay && textOverlay.Lines) {
            const lineConfs = textOverlay.Lines.map((l: any) =>
              l.Words?.reduce((s: number, w: any) => s + (w.Confidence || 0), 0) /
              (l.Words?.length || 1)
            );
            return sum + lineConfs.reduce((s: number, c: number) => s + c, 0) / lineConfs.length;
          }
          return sum;
        }, 0) / (result.ParsedResults?.length || 1) || 0;

      return {
        success: true,
        text: parsedText,
        engine,
        confidence: Math.round(avgConfidence * 100) / 100,
      };
    }

    // Error
    const errorMsg = result.ErrorMessage?.[0] || result.ErrorDetails || "OCR processing failed";
    console.error(`[OCR] Error: ${errorMsg}`);

    return {
      success: false,
      text: "",
      engine,
      confidence: 0,
      errorMessage: errorMsg,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[OCR] Exception after ${elapsed}ms:`, error);

    return {
      success: false,
      text: "",
      engine,
      confidence: 0,
      errorMessage: error instanceof Error ? error.message : "OCR service unavailable",
    };
  }
}

/**
 * Download photo from Telegram and convert to base64
 *
 * @param fileId - Telegram file ID
 * @param botToken - Bot API token
 * @returns Base64-encoded image data
 */
export async function downloadTelegramPhoto(
  fileId: string,
  botToken: string
): Promise<string> {
  // Step 1: Get file path from Telegram
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  const fileInfo: any = await fileInfoRes.json();

  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error("Failed to get file path from Telegram");
  }

  // Step 2: Download the file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
  const fileRes = await fetch(fileUrl);

  if (!fileRes.ok) {
    throw new Error(`Failed to download file: HTTP ${fileRes.status}`);
  }

  // Step 3: Convert to base64
  const arrayBuffer = await fileRes.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Check file size (OCR.space free tier max 1MB)
  const fileSizeKB = Math.round(uint8Array.length / 1024);
  console.log(`[OCR] Downloaded photo: ${fileSizeKB}KB`);

  if (uint8Array.length > 1024 * 1024) {
    throw new Error(`FILE_TOO_LARGE:${fileSizeKB}`);
  }

  // Convert to base64 using btoa (available in Workers runtime)
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
