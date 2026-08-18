import { Readable } from 'stream';
import { Router, type IRouter, type Request, type Response } from 'express';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * Requires an active session. The generated private object path is registered
 * to the authenticated user before it is returned, so a later download cannot
 * cross tenant boundaries merely by knowing another object's path.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    if (!req.session?.authenticated || !req.session?.user?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, size, contentType } = (req.body ?? {}) as {
      name?: string; size?: number; contentType?: string;
    };
    if (!name || typeof size !== 'number' || !contentType) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const userId = req.session.user.userId;

      // Bind this exact private object path to its owner before handing the
      // signed PUT URL to the browser. Random UUID paths make collisions
      // effectively impossible; ON CONFLICT never reassigns an existing owner.
      await db.execute(sql`
        INSERT INTO private_object_ownership (object_path, user_id)
        VALUES (${objectPath}, ${userId})
        ON CONFLICT (object_path) DO NOTHING
      `);

      res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR only to their recorded
 * owner. Authentication alone is not sufficient: the object path must also be
 * registered to the current user in private_object_ownership.
 *
 * Legacy objects that predate the ownership registry are denied by default.
 * They can be backfilled explicitly if a user-owned feature still references
 * them; we never guess ownership from an untrusted URL.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  if (!req.session?.authenticated || !req.session?.user?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const userId = req.session.user.userId;

    const ownershipResult = await db.execute(sql`
      SELECT 1
      FROM private_object_ownership
      WHERE object_path = ${objectPath}
        AND user_id = ${userId}
      LIMIT 1
    `);
    const ownershipRows = (ownershipResult as unknown as { rows?: unknown[] }).rows;
    if (!ownershipRows || ownershipRows.length === 0) {
      req.log.warn({ userId, objectPath }, 'Private object ownership check denied');
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
