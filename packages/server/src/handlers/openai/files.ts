import { defineHandler } from "h3";
import type { H3 } from "h3";
import { HTTPError } from "h3";
import type { FileDeleted, FileObject } from "openai/resources/files";

import { buildFileKey, buildFileMetaKey } from "../../storage";
import type { ServerContext } from "../../types";
import { generateId } from "../../utils";

export function registerFiles(app: H3, context: ServerContext) {
  // POST /files — upload
  app.post(
    "/files",
    defineHandler(async (event) => {
      const form = await event.req.formData();
      const file = form.get("file");
      const purpose = form.get("purpose") as string | null;

      if (!file || !(file instanceof File)) {
        throw new HTTPError({ status: 400, message: "Missing required field: file" });
      }
      if (!purpose) {
        throw new HTTPError({ status: 400, message: "Missing required field: purpose" });
      }

      const content = await file.text();
      const id = generateId("file");

      const meta: FileObject = {
        id,
        bytes: content.length,
        created_at: Math.floor(Date.now() / 1000),
        filename: file.name,
        object: "file",
        purpose: purpose as FileObject["purpose"],
        status: "processed",
      };

      await context.storage!.setItem(buildFileKey(id), content);
      await context.storage!.setItem(buildFileMetaKey(id), meta);

      return meta;
    }),
  );

  // GET /files — list
  app.get(
    "/files",
    defineHandler(async () => {
      const keys = await context.storage!.getKeys("file:");
      const metaKeys = keys.filter((k) => k.endsWith(":meta"));
      const data: FileObject[] = [];
      for (const key of metaKeys) {
        const meta = await context.storage!.getItem<FileObject>(key);
        if (meta) data.push(meta);
      }
      return { object: "list", data };
    }),
  );

  // GET /files/:id — retrieve metadata
  app.get(
    "/files/:id",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const meta = await context.storage!.getItem<FileObject>(buildFileMetaKey(id));
      if (!meta) {
        throw new HTTPError({ status: 404, message: `File ${id} not found` });
      }
      return meta;
    }),
  );

  // GET /files/:id/content — download content
  app.get(
    "/files/:id/content",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const content = await context.storage!.getItemRaw(buildFileKey(id));
      if (content == null) {
        throw new HTTPError({ status: 404, message: `File ${id} not found` });
      }
      return new Response(content as string, {
        headers: { "Content-Type": "text/plain" },
      });
    }),
  );

  // DELETE /files/:id — delete
  app.delete(
    "/files/:id",
    defineHandler(async (event) => {
      const id = event.context.params!.id;
      const meta = await context.storage!.getItem<FileObject>(buildFileMetaKey(id));
      if (!meta) {
        throw new HTTPError({ status: 404, message: `File ${id} not found` });
      }
      await context.storage!.remove(buildFileKey(id));
      await context.storage!.remove(buildFileMetaKey(id));

      const response: FileDeleted = { id, deleted: true, object: "file" };
      return response;
    }),
  );
}
