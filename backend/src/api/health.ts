import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import { pingMysql } from '../config/mysql';
import { pingRedis } from '../config/redis';
import { moTaLoi } from '../utils/moTaLoi';

export const healthRouter = Router();

const startedAt = Date.now();

/** Kết quả kiểm tra một dependency. Union thay vì field optional để hợp với
 *  `exactOptionalPropertyTypes` và để `status` luôn thu hẹp được kiểu. */
type CheckResult = { status: 'ok' } | { status: 'error'; message: string };

async function check(ping: () => Promise<void>): Promise<CheckResult> {
  try {
    await ping();
    return { status: 'ok' };
  } catch (err: unknown) {
    return { status: 'error', message: moTaLoi(err) };
  }
}

/**
 * GET /health — LIVENESS.
 * "Process còn sống không?" Không đụng tới dependency: nếu MySQL chết mà probe
 * này fail thì Kubernetes sẽ restart pod một cách vô ích.
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'bi-platform-backend',
    env: env.NODE_ENV,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready — READINESS.
 * "Có nhận request được không?" Ping thật MySQL + Redis, trả 503 nếu hỏng để
 * load balancer ngừng gửi traffic. Đây chính là `readinessProbe` khi lên K8s.
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  const [mysql, redis] = await Promise.all([check(pingMysql), check(pingRedis)]);
  const ready = mysql.status === 'ok' && redis.status === 'ok';

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: { mysql, redis },
    timestamp: new Date().toISOString(),
  });
});
