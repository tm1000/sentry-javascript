import { captureException, flush, getCurrentHub, Handlers, startTransaction, withScope } from '@sentry/node';
import { extractTraceparentData, getActiveTransaction, hasTracingEnabled } from '@sentry/tracing';
import { addExceptionMechanism, isString, logger, stripUrlQueryAndFragment } from '@sentry/utils';
import { NextApiHandler, NextApiResponse } from 'next';

import { addRequestDataToEvent, NextRequest } from './instrumentServer';

const { parseRequest } = Handlers;

// purely for clarity
type WrappedNextApiHandler = NextApiHandler;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const withSentry = (handler: NextApiHandler): WrappedNextApiHandler => {
  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  return async (req, res) => {
    try {
      const currentScope = getCurrentHub().getScope();

      if (currentScope) {
        currentScope.addEventProcessor(event => addRequestDataToEvent(event, req as NextRequest));

        if (hasTracingEnabled()) {
          // If there is a trace header set, extract the data from it (parentSpanId, traceId, and sampling decision)
          let traceparentData;
          if (req.headers && isString(req.headers['sentry-trace'])) {
            traceparentData = extractTraceparentData(req.headers['sentry-trace'] as string);
            logger.log(`[Tracing] Continuing trace ${traceparentData?.traceId}.`);
          }

          const url = `${req.url}`;
          // pull off query string, if any
          let reqPath = stripUrlQueryAndFragment(url);
          // Replace with placeholder
          if (req.query) {
            // TODO get this from next if possible, to avoid accidentally replacing non-dynamic parts of the path if
            // they match dynamic parts
            for (const [key, value] of Object.entries(req.query)) {
              reqPath = reqPath.replace(`${value}`, `[${key}]`);
            }
          }
          const reqMethod = `${(req.method || 'GET').toUpperCase()} `;

          const transaction = startTransaction(
            {
              name: `${reqMethod}${reqPath}`,
              op: 'http.server',
              ...traceparentData,
            },
            // extra context passed to the `tracesSampler`
            { request: req },
          );
          currentScope.setSpan(transaction);

          res.on('finish', async () => await finishTransaction(res));
        }
      }

      return await handler(req, res); // Call original handler
    } catch (e) {
      withScope(scope => {
        scope.addEventProcessor(event => {
          addExceptionMechanism(event, {
            handled: false,
          });
          return parseRequest(event, req);
        });
        captureException(e);
      });
      await finishTransaction(res);
      throw e;
    }
  };
};

async function finishTransaction(res: NextApiResponse): Promise<void> {
  const transaction = getActiveTransaction();

  if (!transaction) {
    // nothing to do
    return Promise.resolve();
  }

  // now that we have the transaction, pop it off of the scope so it doesn't affect future requests
  // TODO use domains?
  getCurrentHub()
    .getScope()
    ?.setSpan(undefined);

  transaction.setHttpStatus(res.statusCode);

  const finishPromise = new Promise<void>((resolve, reject) => {
    // Push `transaction.finish` to the next event loop so open spans have a chance to finish before the
    // transaction closes
    setImmediate(async () => {
      transaction.finish();
      try {
        logger.log('Flushing event buffer');
        await flush(2000);
        logger.log('Buffer flushed');
        resolve();
      } catch (err) {
        logger.log('Error while flushing buffer:', err);
        reject(err);
      }
    });
  });

  return finishPromise;
}
