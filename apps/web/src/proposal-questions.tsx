import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from "lucide-react";
import "./proposal-questions.css";

export type ProposalQuestion = {
  id: string;
  prompt: string;
  required: boolean;
};
export type ProposalAnswer = {
  questionId: string;
  prompt: string;
  required: boolean;
  answer: string;
};

const questionLimit = 10;
const suggestions = [
  "Have you completed similar work? Share an example.",
  "Who will lead the work, and how large is your team?",
  "What do you need from us before you can start?",
  "Which licenses or certifications are relevant to this work?",
];

export function QuestionBuilder({
  value,
  onChange,
  disabled = false,
}: {
  value: ProposalQuestion[];
  onChange: (questions: ProposalQuestion[]) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!focusId) return;
    const field = fields.current.get(focusId);
    if (field) {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
      setFocusId(null);
    }
  }, [focusId, value]);
  const add = (prompt = "") => {
    if (disabled || value.length >= questionLimit) return;
    const id = crypto.randomUUID();
    onChange([...value, { id, prompt, required: true }]);
    setFocusId(id);
    setAnnouncement(`Question ${value.length + 1} added.`);
  };
  const update = (id: string, changes: Partial<ProposalQuestion>) => {
    onChange(
      value.map((question) =>
        question.id === id ? { ...question, ...changes } : question,
      ),
    );
  };
  const move = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (disabled || destination < 0 || destination >= value.length) return;
    const next = [...value];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
    setAnnouncement(`Question moved to position ${destination + 1}.`);
  };
  const remove = (index: number) => {
    if (disabled) return;
    const remaining = value.filter((_, position) => position !== index);
    onChange(remaining);
    if (remaining.length)
      setFocusId(remaining[Math.min(index, remaining.length - 1)].id);
    setAnnouncement(`Question ${index + 1} removed.`);
  };
  return (
    <section
      className="proposal-questions proposal-question-builder"
      aria-labelledby={`${prefix}-heading`}
    >
      <header className="proposal-section-heading">
        <span className="proposal-section-icon">
          <ListChecks size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id={`${prefix}-heading`}>Questions for companies</h3>
          <p>
            Ask what you need to compare quotes. Companies answer when they
            quote.
          </p>
        </div>
        <span className="proposal-question-total">
          {value.length} / {questionLimit}
        </span>
      </header>
      {!!value.length && (
        <ol className="proposal-question-list">
          {value.map((question, index) => (
            <li className="proposal-question-editor" key={question.id}>
              <label
                className="proposal-question-prompt-label"
                htmlFor={`proposal-question-${question.id}`}
              >
                <span className="proposal-question-number">{index + 1}</span>
                Question {index + 1}
              </label>
              <textarea
                id={`proposal-question-${question.id}`}
                ref={(node) => {
                  if (node) fields.current.set(question.id, node);
                  else fields.current.delete(question.id);
                }}
                rows={2}
                value={question.prompt}
                maxLength={500}
                required
                disabled={disabled}
                placeholder="What would you like to know?"
                onChange={(event) =>
                  update(question.id, { prompt: event.target.value })
                }
              />
              <div className="proposal-question-options">
                <label className="proposal-question-required">
                  <input
                    type="checkbox"
                    checked={question.required}
                    disabled={disabled}
                    onChange={(event) =>
                      update(question.id, { required: event.target.checked })
                    }
                  />
                  Answer required
                </label>
                {question.prompt.length > 400 && (
                  <span className="proposal-character-count">
                    {question.prompt.length} / 500
                  </span>
                )}
                <div className="proposal-question-controls">
                  <button
                    type="button"
                    aria-label={`Move question ${index + 1} up`}
                    title="Move up"
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move question ${index + 1} down`}
                    title="Move down"
                    disabled={disabled || index === value.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove question ${index + 1}`}
                    title="Remove question"
                    disabled={disabled}
                    onClick={() => remove(index)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="proposal-builder-actions">
        <button
          type="button"
          className="proposal-add-question"
          disabled={disabled || value.length >= questionLimit}
          onClick={() => add()}
        >
          <Plus size={17} />
          Add a question
        </button>
        {value.length >= questionLimit && <span>Maximum of 10 questions.</span>}
      </div>
      {value.length < questionLimit && (
        <details className="proposal-question-suggestions">
          <summary>Start with a suggestion</summary>
          <div>
            {suggestions
              .filter(
                (prompt) =>
                  !value.some((question) => question.prompt.trim() === prompt),
              )
              .map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  disabled={disabled}
                  onClick={() => add(prompt)}
                >
                  <Plus size={14} />
                  <span>{prompt}</span>
                </button>
              ))}
          </div>
        </details>
      )}
      <span className="proposal-screen-reader" role="status" aria-live="polite">
        {announcement}
      </span>
    </section>
  );
}

export function ProposalAnswerFields({
  questions,
  answers,
  onChange,
  disabled = false,
}: {
  questions: ProposalQuestion[];
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const prefix = useId();
  if (!questions.length) return null;
  return (
    <section
      className="proposal-questions proposal-answer-fields"
      aria-labelledby={`${prefix}-heading`}
    >
      <header className="proposal-section-heading">
        <span className="proposal-section-icon">
          <ListChecks size={19} aria-hidden="true" />
        </span>
        <div>
          <h3 id={`${prefix}-heading`}>Questions from the hiring company</h3>
          <p>Answer the required questions to complete your quote.</p>
        </div>
      </header>
      <ol className="proposal-question-list">
        {questions.map((question, index) => (
          <li className="proposal-answer-field" key={question.id}>
            <label htmlFor={`proposal-answer-${question.id}`}>
              <span className="proposal-question-number">{index + 1}</span>
              <span className="proposal-answer-prompt">
                {question.prompt}
                <small>{question.required ? "Required" : "Optional"}</small>
              </span>
            </label>
            <textarea
              id={`proposal-answer-${question.id}`}
              rows={3}
              value={answers[question.id] || ""}
              maxLength={5000}
              required={question.required}
              disabled={disabled}
              placeholder="Write your answer…"
              onChange={(event) =>
                onChange({ ...answers, [question.id]: event.target.value })
              }
              aria-describedby={
                answers[question.id]?.length > 4500
                  ? `${prefix}-${question.id}-count`
                  : undefined
              }
            />
            {answers[question.id]?.length > 4500 && (
              <span
                id={`${prefix}-${question.id}-count`}
                className="proposal-character-count"
              >
                {answers[question.id].length.toLocaleString()} / 5,000
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProposalAnswers({ answers }: { answers: ProposalAnswer[] }) {
  const prefix = useId();
  if (!answers.length) return null;
  return (
    <section
      className="proposal-questions proposal-answers"
      aria-labelledby={`${prefix}-heading`}
    >
      <header className="proposal-section-heading">
        <span className="proposal-section-icon">
          <ListChecks size={18} aria-hidden="true" />
        </span>
        <div>
          <h3 id={`${prefix}-heading`}>Answers to job questions</h3>
        </div>
      </header>
      <dl className="proposal-answer-list">
        {answers.map((answer, index) => (
          <div
            className="proposal-answer-review"
            key={`${answer.questionId}-${index}`}
          >
            <dt>
              <span className="proposal-question-number">{index + 1}</span>
              <span>{answer.prompt}</span>
            </dt>
            <dd>
              {answer.answer.trim() ? (
                <p>{answer.answer}</p>
              ) : (
                <p className="proposal-unanswered">
                  {answer.required
                    ? "No answer provided."
                    : "Optional question · Not answered."}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
