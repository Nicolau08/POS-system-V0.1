import { HttpError } from '../utils/response.js';

function runValidator(validator, value, sourceLabel) {
  if (!validator) return;
  const result = validator(value);
  if (result === true || result == null) return;
  if (typeof result === 'string') throw new HttpError(400, `${sourceLabel}: ${result}`);
  if (result instanceof Error) throw result;
  throw new HttpError(400, `${sourceLabel}: valor invalido`);
}

export function validateRequest({ body, query, params } = {}) {
  return (req, _res, next) => {
    try {
      runValidator(body, req.body ?? {}, 'body');
      runValidator(query, req.query ?? {}, 'query');
      runValidator(params, req.params ?? {}, 'params');
      next();
    } catch (error) {
      next(error);
    }
  };
}
