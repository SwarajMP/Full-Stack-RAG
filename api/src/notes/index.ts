import { Document } from "langchain/document";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { formatDocumentsAsString } from "langchain/util/document";
import {
  ArxivPaperNote,
  NOTES_TOOL_SCHEMA,
  NOTE_PROMPT,
  outputParser,
} from "notes/prompt.js";
import { SupabaseDatabase } from "database.js";
import { writeFile, unlink, readFile as fsReadFile } from "fs/promises";
import { UnstructuredLoader } from "langchain/document_loaders/fs/unstructured";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import axios from "axios";
import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "url";

async function loadPdfFromUrl(url: string): Promise<Buffer> {
  try {
    // Support file:// scheme
    if (url.startsWith("file://")) {
      const filePath = fileURLToPath(new URL(url));
      return await fsReadFile(filePath);
    }
    // Support bare local Windows/Unix paths
    const looksLikeLocalPath =
      /^[A-Za-z]:\\/.test(url) || url.startsWith("/") || url.includes("\\");
    if (looksLikeLocalPath && !/^https?:\/\//i.test(url)) {
      return await fsReadFile(url);
    }
    // Fallback to HTTP(S)
    const response = await axios({
      method: "GET",
      url,
      responseType: "arraybuffer",
      timeout: 30000,
    });
    return response.data;
  } catch (err: any) {
    console.error("Failed to load PDF:", err?.message || err);
    throw new Error("download_pdf_failed");
  }
}

async function deletePagesFromPdf(
  pdf: Buffer,
  pagesToDelete: number[]
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdf);
  let numToOffsetBy = 1;
  for (const pageNumber of pagesToDelete) {
    pdfDoc.removePage(pageNumber - numToOffsetBy);
    numToOffsetBy += 1;
  }
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function generateNotes(
  documents: Array<Document>
): Promise<Array<ArxivPaperNote>> {
  const documentsAsString = formatDocumentsAsString(documents);
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
  });
  const modelWithTools = model.bind({
    tools: [NOTES_TOOL_SCHEMA],
    tool_choice: "auto",
  });
  const chain = NOTE_PROMPT.pipe(modelWithTools).pipe(outputParser);
  const response = await chain.invoke({
    paper: documentsAsString,
  });
  return response;
}

async function convertPdfToDocuments(pdf: Buffer): Promise<Array<Document>> {
  const randomName = Math.random().toString(36).substring(7);
  const pdfPath = `pdfs/${randomName}.pdf`;
  await writeFile(pdfPath, pdf, "binary");

  // Prefer Unstructured when available
  if (process.env.UNSTRUCTURED_API_KEY) {
    try {
      const loader = new UnstructuredLoader(pdfPath, {
        apiKey: process.env.UNSTRUCTURED_API_KEY,
        strategy: "hi_res",
      });
      const docs = await Promise.race([
        loader.load(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("unstructured_timeout")), 60000)
        ),
      ]);
      await unlink(pdfPath);
      return docs;
    } catch (err: any) {
      console.error("Unstructured parsing failed:", err?.message || err);
      // fall through to PDFLoader fallback
    }
  }

  // Fallback: local PDF parsing via PDFLoader (no external service)
  try {
    const pdfLoader = new PDFLoader(pdfPath);
    const docs = await pdfLoader.load();
    await unlink(pdfPath);
    return docs;
  } catch (err: any) {
    console.error("Local PDF parsing failed:", err?.message || err);
    await unlink(pdfPath).catch(() => undefined);
    throw new Error("pdf_parse_failed");
  }
}

export async function takeNotes(
  paperUrl: string,
  name: string,
  pagesToDelete?: number[]
): Promise<ArxivPaperNote[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }
  const database = await SupabaseDatabase.fromExistingIndex();
  const existingPaper = await database.getPaper(paperUrl);
  if (existingPaper) {
    return existingPaper.notes as Array<ArxivPaperNote>;
  }

  let pdfAsBuffer: Buffer;
  try {
    pdfAsBuffer = await loadPdfFromUrl(paperUrl);
  } catch (err) {
    throw err; // already wrapped
  }

  if (pagesToDelete && pagesToDelete.length > 0) {
    try {
      pdfAsBuffer = await deletePagesFromPdf(pdfAsBuffer, pagesToDelete);
    } catch (err: any) {
      console.error("PDF page deletion failed:", err?.message || err);
      throw new Error("pdf_edit_failed");
    }
  }

  let documents: Array<Document>;
  try {
    documents = await convertPdfToDocuments(pdfAsBuffer);
  } catch (err) {
    throw err; // already wrapped
  }

  let notes: Array<ArxivPaperNote>;
  try {
    notes = await generateNotes(documents);
  } catch (err: any) {
    console.error("OpenAI notes generation failed:", err?.message || err);
    throw new Error("openai_failed");
  }

  const newDocs: Array<Document> = documents.map((doc) => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      url: paperUrl,
    },
  }));

  // Save paper first so user gets notes even if embeddings fail
  try {
    await database.addPaper({
      paper: formatDocumentsAsString(newDocs),
      url: paperUrl,
      notes,
      name,
    });
  } catch (err: any) {
    console.error("Supabase save failed:", err?.message || err);
    throw new Error("database_failed");
  }

  // Best-effort vectorization: do not fail the request if embeddings quota is exceeded
  try {
    await database.vectorStore.addDocuments(newDocs);
  } catch (err: any) {
    console.warn("Vector indexing skipped due to error:", err?.message || err);
  }

  return notes;
}
