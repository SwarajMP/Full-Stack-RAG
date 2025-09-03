import { SupabaseDatabase } from "database.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { Document } from "langchain/document";
import { ArxivPaperNote } from "notes/prompt.js";
import {
  ANSWER_QUESTION_TOOL_SCHEMA,
  QA_OVER_PAPER_PROMPT,
  answerOutputParser,
} from "./prompt.js";
import { formatDocumentsAsString } from "langchain/util/document";

async function qaModel(
  question: string,
  documents: Array<Document>,
  notes: Array<ArxivPaperNote>
) {
  const model = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0,
  });
  const modelWithTools = model.bind({
    tools: [ANSWER_QUESTION_TOOL_SCHEMA],
    tool_choice: "auto",
  });
  const chain =
    QA_OVER_PAPER_PROMPT.pipe(modelWithTools).pipe(answerOutputParser);
  if (!documents) {
    throw new Error("No documents found");
  }
  const documentsAsString = formatDocumentsAsString(documents);
  const notesAsString = notes.map((note) => note.note).join("\n");
  const response = await chain.invoke({
    relevantDocuments: documentsAsString,
    notes: notesAsString,
    question,
  });

  return response;
}

export async function qaOnPaper(question: string, paperUrl: string) {
  const database = await SupabaseDatabase.fromExistingIndex();
  let documents: Array<Document> = [];
  try {
    documents = await database.vectorStore.similaritySearch(question, 8, {
      url: paperUrl,
    });
  } catch (err: any) {
    console.warn("Similarity search failed, will fall back:", err?.message || err);
  }

  const paper = await database.getPaper(paperUrl);
  if (!paper?.notes) {
    throw new Error("No notes found");
  }
  const { notes } = paper;
  // Fallback: if we have no documents, create a synthetic doc from stored paper
  if (!documents || documents.length === 0) {
    if (paper.paper) {
      documents = [
        new Document({
          pageContent: paper.paper as unknown as string,
          metadata: { source: "supabase-paper-fallback" },
        }),
      ];
    }
  }

  const answerAndQuestions = await qaModel(question, documents, notes as unknown as Array<ArxivPaperNote>);
  await Promise.all(
    answerAndQuestions.map(async (qa) =>
      database.saveQa(
        question,
        qa.answer,
        formatDocumentsAsString(documents),
        qa.followupQuestions
      )
    )
  );
  return answerAndQuestions;
}
