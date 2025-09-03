import express from "express";
import { takeNotes } from "notes/index.js";
import { qaOnPaper } from "qa/index.js";

function processPagesToDelete(pagesToDelete: string): Array<number> {
  const numArr = pagesToDelete.split(",").map((num) => parseInt(num.trim()));
  return numArr;
}

function main() {
  const app = express();
  const port = process.env.PORT || 8080;

  app.use(express.json());

  app.get("/", (_req, res) => {
    // health check
    res.status(200).send("ok");
  });

  app.post("/take_notes", async (req, res) => {
    try {
      const { paperUrl, name, pagesToDelete } = req.body ?? {};
      if (!paperUrl || !name) {
        return res.status(400).json({
          error: "Missing required fields: paperUrl, name",
        });
      }
      const pagesToDeleteArray = pagesToDelete
        ? processPagesToDelete(pagesToDelete)
        : undefined;
      const notes = await takeNotes(paperUrl, name, pagesToDeleteArray ?? []);
      res.status(200).send(notes);
      return;
    } catch (err: any) {
      console.error("/take_notes error:", err);
      res.status(500).json({ error: err?.message || "Internal Server Error" });
    }
  });

  app.post("/qa", async (req, res) => {
    try {
      const { paperUrl, question } = req.body ?? {};
      if (!paperUrl || !question) {
        return res.status(400).json({
          error: "Missing required fields: paperUrl, question",
        });
      }
      const qa = await qaOnPaper(question, paperUrl);
      res.status(200).send(qa);
      return;
    } catch (err: any) {
      console.error("/qa error:", err);
      res.status(500).json({ error: err?.message || "Internal Server Error" });
    }
  });

  // Global error handler as a safety net
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: err?.message || "Internal Server Error" });
  });

  app.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}
main();
