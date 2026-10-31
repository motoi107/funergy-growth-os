import { createHandler } from './handler.mjs';

// The PIN sign-in check verifies body.pin_session exactly as auth-pin issues it (the same settings) and returns
// { name } or { emp_id } of the signed-in employee, or null. It follows auth-pin, whose source is not kept in this public
// repository, so it is not here either: the one file deployed to Supabase (given to Moto directly, v1072) adds it in place
// of this null. Run from this repository as it is, every PIN sign-in gets 'pin_check_missing' (503) and the email sign-in works.
const verifyPin = null;

Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), verifyPin }));
