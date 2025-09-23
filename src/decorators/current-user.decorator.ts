import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

/**
 * Универсальный декоратор для получения userId
 * Работает и в HTTP, и в микросервисах (Kafka/Redis events)
 */
export const CurrentUser = createParamDecorator(
    (data: unknown, ctx: ExecutionContext): number | null => {
        // ⚡ HTTP-запрос (REST)
        if (ctx.getType() === 'http') {
            const request = ctx.switchToHttp().getRequest();
            return request.user?.id ?? null;
        }

        // ⚡ RPC-запрос (Kafka, Redis, NATS и т.п.)
        if (ctx.getType() === 'rpc') {
            const rpcData = ctx.switchToRpc().getData();
            // если userId передан внутри payload
            return rpcData?.userId ?? null;
        }

        // ⚡ WebSocket (если понадобится)
        if (ctx.getType() === 'ws') {
            const client = ctx.switchToWs().getClient();
            return client?.user?.id ?? null;
        }

        throw new RpcException('Cannot extract CurrentUser: unsupported context');
    },
);
