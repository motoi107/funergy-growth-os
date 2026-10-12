import { createHandler } from './handler.mjs';

// TODO(段階 4・PIN): pass the real PIN sign-in check here. It must verify body.pin_session exactly as auth-pin issues it
// (the same key and form, read from the function's settings) and return { emp_id, name } of the signed-in employee, or null.
// auth-pin's source is not kept in this public repository. Until it is added, verifyPin is null and every PIN sign-in is
// refused (email sign-in works as before).
const verifyPin = null;

Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), verifyPin }));
