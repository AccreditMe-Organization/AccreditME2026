import { IUser } from './user.interface';

// ACC-46 Section 2.6.b Step 6 / 2.6.e — widened from a plain IUser: a
// promotion's own Head-assignment step (commit 6) can fail even after the
// core transfer has already committed, and the caller needs to be told
// that distinctly, not have it look like total failure or be silently
// swallowed into an ordinary success.
export interface ITransferResult {
  user: IUser;
  // Always true for a non-promotion transfer (nothing to fail post-commit
  // in that branch) or a successful promotion; false only for the
  // specific promotion partial-failure case in 2.6.e (commit 6).
  promotionCompleted: boolean;
  // Present only when promotionCompleted is false — assignHead()'s own
  // thrown message, verbatim (commit 6).
  promotionError?: string;
}
