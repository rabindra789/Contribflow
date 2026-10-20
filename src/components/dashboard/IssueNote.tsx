import { useId, useRef, useState } from 'react';
import {
  MAX_NOTE_BODY_LENGTH,
  type IsoTimestamp,
  type IssueNote,
  type SavedIssue,
} from '../../domain/models';
import { formatDashboardTimestamp } from '../../lib/dashboard-view';
import {
  primaryButtonClass,
  quietButtonClass,
  secondaryButtonClass,
} from './button-classes';

interface IssueNoteProps {
  issue: SavedIssue;
  note: IssueNote | undefined;
  actionsDisabled: boolean;
  pending: boolean;
  onSave(
    body: string,
    expectedUpdatedAt: IsoTimestamp | null,
  ): Promise<boolean>;
  onDelete(expectedUpdatedAt: IsoTimestamp | null): Promise<boolean>;
}

type NoteOperation = 'save' | 'delete';

export function IssueNote({
  issue,
  note,
  actionsDisabled,
  pending,
  onSave,
  onDelete,
}: IssueNoteProps) {
  const noteId = useId();
  const countId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<IsoTimestamp | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [operation, setOperation] = useState<NoteOperation | null>(null);
  const operationRef = useRef(false);
  const reference = `${issue.owner}/${issue.repo}#${issue.number}`;
  const valid =
    draft.trim().length > 0 && draft.length <= MAX_NOTE_BODY_LENGTH;

  function startEditing(): void {
    setDraft(note?.body ?? '');
    setBaseUpdatedAt(note?.updatedAt ?? null);
    setConfirmingDelete(false);
    setEditing(true);
  }

  function stopEditing(): void {
    setEditing(false);
    setConfirmingDelete(false);
    setOperation(null);
  }

  async function saveNote(): Promise<void> {
    if (!valid || operationRef.current) {
      return;
    }
    operationRef.current = true;
    setOperation('save');
    try {
      if (await onSave(draft, baseUpdatedAt)) {
        stopEditing();
      }
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  }

  async function deleteNote(): Promise<void> {
    if (baseUpdatedAt === null || operationRef.current) {
      return;
    }
    operationRef.current = true;
    setOperation('delete');
    try {
      if (await onDelete(baseUpdatedAt)) {
        stopEditing();
      }
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  }

  return (
    <section
      aria-labelledby={`${noteId}-heading`}
      aria-busy={pending}
      className="mt-3 border-t border-line pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4
          id={`${noteId}-heading`}
          className="text-xs font-semibold text-ink"
        >
          Private note
        </h4>
        {!editing ? (
          <button
            type="button"
            className={quietButtonClass}
            disabled={actionsDisabled}
            aria-label={
              note === undefined
                ? `Add note for ${reference}`
                : `Edit note for ${reference}`
            }
            onClick={startEditing}
          >
            {note === undefined ? 'Add note' : 'Edit note'}
          </button>
        ) : null}
      </div>

      {!editing && note !== undefined ? (
        <>
          <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-ink">
            {note.body}
          </p>
          <p className="mt-2 text-xs text-muted">
            Updated:{' '}
            <time dateTime={note.updatedAt}>
              {formatDashboardTimestamp(note.updatedAt)}
            </time>
          </p>
        </>
      ) : null}

      {!editing && note === undefined ? (
        <p className="mt-1 text-xs text-muted">
          No note yet. Notes stay in this browser.
        </p>
      ) : null}

      {editing ? (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNote();
          }}
        >
          <label htmlFor={noteId} className="text-xs font-medium text-ink">
            Note
          </label>
          <textarea
            id={noteId}
            className="mt-1 w-full resize-y rounded border border-line bg-canvas px-2.5 py-2 text-sm text-ink"
            rows={4}
            maxLength={MAX_NOTE_BODY_LENGTH}
            aria-describedby={countId}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <p id={countId} className="mt-1 text-xs text-muted">
            {draft.length}/{MAX_NOTE_BODY_LENGTH} characters
            {draft.length > MAX_NOTE_BODY_LENGTH ? ' · Note is too long.' : ''}
          </p>

          {confirmingDelete ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">
                Delete this private note?
              </span>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={actionsDisabled || operation !== null}
                aria-label={`Cancel deleting note for ${reference}`}
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={actionsDisabled || operation !== null}
                aria-label={`Confirm deleting note for ${reference}`}
                onClick={() => {
                  void deleteNote();
                }}
              >
                {operation === 'delete' ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className={primaryButtonClass}
                disabled={!valid || actionsDisabled || operation !== null}
              >
                {operation === 'save' ? 'Saving...' : 'Save note'}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={actionsDisabled || operation !== null}
                aria-label={`Cancel editing note for ${reference}`}
                onClick={stopEditing}
              >
                Cancel
              </button>
              {note !== undefined && baseUpdatedAt !== null ? (
                <button
                  type="button"
                  className={quietButtonClass}
                  disabled={actionsDisabled || operation !== null}
                  aria-label={`Delete note for ${reference}`}
                  onClick={() => {
                    setConfirmingDelete(true);
                  }}
                >
                  Delete note
                </button>
              ) : null}
            </div>
          )}
        </form>
      ) : null}
    </section>
  );
}
