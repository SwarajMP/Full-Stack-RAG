import React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const submitPaperFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  paperUrl: z.string().url("Valid URL required"),
  pagesToDelete: z.string().optional(),
});

const questionFormSchema = z.object({
  question: z.string().min(1, "Question is required"),
});

type SubmitPaperForm = z.infer<typeof submitPaperFormSchema>;
type QuestionForm = z.infer<typeof questionFormSchema>;

function processPagesToDelete(pagesToDelete: string): Array<number> {
  if (!pagesToDelete) return [];
  return pagesToDelete
    .split(",")
    .map((num) => parseInt(num.trim()))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

type ArxivPaperNote = {
  note: string;
  pageNumbers: number[];
};

type QAResponse = {
  answer: string;
  followupQuestions: string[];
};

export default function HomePage() {
  const [submittedPaperData, setSubmittedPaperData] = React.useState<
    | (SubmitPaperForm & { pagesToDelete?: string })
    | null
  >(null);
  const [notes, setNotes] = React.useState<ArxivPaperNote[] | null>(null);
  const [answers, setAnswers] = React.useState<QAResponse[] | null>(null);
  const [notesLoading, setNotesLoading] = React.useState(false);
  const [qaLoading, setQaLoading] = React.useState(false);
  const [notesError, setNotesError] = React.useState<string | null>(null);
  const [qaError, setQaError] = React.useState<string | null>(null);

  const paperForm = useForm<SubmitPaperForm>({
    resolver: zodResolver(submitPaperFormSchema),
    defaultValues: {
      name: "",
      paperUrl: "",
      pagesToDelete: "",
    },
  });

  const questionForm = useForm<QuestionForm>({
    resolver: zodResolver(questionFormSchema),
    defaultValues: {
      question: "",
    },
  });

  async function onPaperSubmit(values: SubmitPaperForm) {
    setSubmittedPaperData({
      ...values,
      pagesToDelete: values.pagesToDelete
        ? values.pagesToDelete
        : undefined,
    });

    setNotes(null);
    setAnswers(null);
    setNotesError(null);
    setQaError(null);
    setNotesLoading(true);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(
        "/api/take_notes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...values,
            pagesToDelete: values.pagesToDelete,
          }),
          signal: controller.signal,
        }
      );
      clearTimeout(id);

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const msg = errJson?.error || `Server error: ${response.status}`;
        throw new Error(msg);
      }

      const data = (await response.json()) as ArxivPaperNote[];
      setNotes(data);
    } catch (err) {
      console.error(err);
      setNotesError(err instanceof Error ? err.message : "Failed to take notes");
    }
    setNotesLoading(false);
  }

  async function onQuestionSubmit(values: QuestionForm) {
    if (!submittedPaperData) {
      alert("Please submit a paper first");
      return;
    }

    const data = {
      ...values,
      paperUrl: submittedPaperData.paperUrl,
    };

    setQaError(null);
    setQaLoading(true);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 60000);
      const response = await fetch("/api/qa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      clearTimeout(id);

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const msg = errJson?.error || `Server error: ${response.status}`;
        throw new Error(msg);
      }

      const result = (await response.json()) as QAResponse[];
      setAnswers(result);
    } catch (err) {
      console.error(err);
      setQaError(err instanceof Error ? err.message : "Failed to run QA");
    }
    setQaLoading(false);
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Paper RAG</h1>

      <div className="space-y-4">
        <h2 className="text-xl font-medium">Submit Paper</h2>
        <Form {...paperForm}>
          <form
            onSubmit={paperForm.handleSubmit(onPaperSubmit)}
            className="space-y-4"
          >
            <FormField
              control={paperForm.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Paper name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={paperForm.control}
              name="paperUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>PDF URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://arxiv.org/...pdf" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={paperForm.control}
              name="pagesToDelete"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Pages to delete (comma-separated)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., 1,2,3" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={notesLoading}>
              {notesLoading ? "Taking Notes..." : "Take Notes"}
            </Button>
          </form>
        </Form>
      </div>

      {notesError && (
        <p className="text-red-600">Error: {notesError}</p>
      )}

      {notes && (
        <div className="space-y-2">
          <h2 className="text-xl font-medium">Notes</h2>
          <ul className="list-disc pl-5 space-y-1">
            {notes.map((n, idx) => (
              <li key={idx}>
                <span className="font-medium">Pages {n.pageNumbers.join(", ")}: </span>
                {n.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-medium">Ask a Question</h2>
        <Form {...questionForm}>
          <form
            onSubmit={questionForm.handleSubmit(onQuestionSubmit)}
            className="space-y-4"
          >
            <FormField
              control={questionForm.control}
              name="question"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What is the main contribution?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={qaLoading || !notes}>
              {qaLoading ? "Asking..." : "Ask"}
            </Button>
          </form>
        </Form>
      </div>

      {qaError && <p className="text-red-600">Error: {qaError}</p>}

      {answers && (
        <div className="space-y-3">
          <h2 className="text-xl font-medium">Answers</h2>
          <ul className="space-y-3">
            {answers.map((a, idx) => (
              <li key={idx} className="rounded-md border p-3">
                <p className="mb-2">{a.answer}</p>
                {a.followupQuestions?.length ? (
                  <ul className="list-disc pl-5">
                    {a.followupQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
