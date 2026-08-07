import { Router, type Request, type Response } from 'express';

/**
 * Router gốc của API v1. Các nhóm route sau này gắn vào đây:
 *   v1Router.use('/projects', projectsRouter)
 *   v1Router.use('/datasets', datasetsRouter)
 *   v1Router.use('/query',    queryRouter)
 */
export const v1Router = Router();

v1Router.get('/', (_req: Request, res: Response) => {
  res.json({ name: 'BI Platform API', version: 'v1' });
});
