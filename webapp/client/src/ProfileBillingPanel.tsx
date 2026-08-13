/**
 * Account management: plan, status, card, remaining allowances, Stripe portal.
 * Sign out is primary account exit. Delete is intentionally buried + asks why first.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  ACCENT,
  ACCENT_WASH,
  BAD,
  CANVAS,
  FONT_BRAND,
  FONT_MONO,
  FONT_UI,
  INK,
  LINE,
  PAPER,
  SLATE,
} from "./theme/tokens";

const API_BASE = "/api";

type BillingMe = {
  plan: "free" | "pro" | "team";
  status: string;
  currentPeriodEnd: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
  cancelAtPeriodEnd?: boolean;
  canUseAiAgent?: boolean;
  canUseDesignChat?: boolean;
  designMessagesRemaining?: number;
  freeDesignLimit?: number;
  scansRemaining?: number;
  freeScanLimit?: number;
};

type DeleteStep = "hidden" | "hint" | "why" | "confirm";

const DELETE_REASONS = [
  { id: "too_expensive", label: "Too expensive" },
  { id: "not_using", label: "Not using it enough" },
  { id: "missing_features", label: "Missing features I need" },
  { id: "switched", label: "Switched to another tool" },
  { id: "privacy", label: "Privacy / data concerns" },
  { id: "other", label: "Something else" },
] as const;

type Props = {
  accessToken: string;
  onClose: () => void;
  onUpgrade?: () => void;
  onSignOut?: () => void | Promise<void>;
  /** Called only after why + typed confirm. Backend may still be stubbed. */
  onDeleteAccount?: (payload: {
    reasonId: string;
    reasonDetail: string;
  }) => void | Promise<void>;
};

export default function ProfileBillingPanel({
  accessToken,
  onClose,
  onUpgrade,
  onSignOut,
  onDeleteAccount,
}: Props) {
  const [data, setData] = useState<BillingMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [deleteStep, setDeleteStep] = useState<DeleteStep>("hidden");
  const [reasonId, setReasonId] = useState<string>("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/billing/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await res.json().catch(() => ({}))) as BillingMe & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load billing");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/billing/portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not open billing portal");
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
      onClose();
    } finally {
      setSigningOut(false);
    }
  };

  const resetDeleteFlow = () => {
    setDeleteStep("hidden");
    setReasonId("");
    setReasonDetail("");
    setConfirmText("");
    setDeleteError(null);
  };

  /** Require a short written answer for every reason — friction by design. */
  const whyHasAnswer = Boolean(reasonId) && reasonDetail.trim().length >= 12;

  const confirmReady = confirmText.trim().toUpperCase() === "DELETE";

  const submitDelete = async () => {
    if (!whyHasAnswer || !confirmReady || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (onDeleteAccount) {
        await onDeleteAccount({ reasonId, reasonDetail: reasonDetail.trim() });
      } else {
        const res = await fetch(`${API_BASE}/account/delete`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reasonId,
            reasonDetail: reasonDetail.trim(),
            confirm: "DELETE",
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(
            body.error ??
              (res.status === 404
                ? "Account deletion isn’t available yet. Sign out and contact support if you need help."
                : "Could not delete account")
          );
        }
      }
      onClose();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const periodLabel = data?.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString()
    : null;

  return (
    <div
      role="dialog"
      aria-label="Profile billing"
      data-testid="profile-billing-panel"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(18,19,26,0.45)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 55,
        fontFamily: FONT_UI,
      }}
      onClick={() => {
        resetDeleteFlow();
        onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          background: CANVAS,
          border: `1px solid ${LINE}`,
          borderRadius: 18,
          padding: 26,
          color: INK,
          boxShadow: "0 30px 80px rgba(18,19,26,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div
              style={{
                fontFamily: FONT_BRAND,
                fontSize: 14,
                fontWeight: 400,
                textTransform: "lowercase",
                color: ACCENT,
              }}
            >
              blanko
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {deleteStep === "why" || deleteStep === "confirm"
                ? "Close account"
                : "Account & billing"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              resetDeleteFlow();
              onClose();
            }}
            style={{
              background: CANVAS,
              border: `1px solid ${LINE}`,
              borderRadius: 999,
              width: 30,
              height: 30,
              alignSelf: "flex-start",
              color: SLATE,
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {deleteStep === "why" || deleteStep === "confirm" ? (
          <DeleteFlow
            step={deleteStep}
            reasonId={reasonId}
            reasonDetail={reasonDetail}
            confirmText={confirmText}
            whyHasAnswer={whyHasAnswer}
            confirmReady={confirmReady}
            deleteBusy={deleteBusy}
            deleteError={deleteError}
            plan={data?.plan}
            onBack={() => {
              if (deleteStep === "confirm") {
                setDeleteStep("why");
                setConfirmText("");
                setDeleteError(null);
              } else {
                setDeleteStep("hint");
              }
            }}
            onCancel={() => resetDeleteFlow()}
            onReasonId={setReasonId}
            onReasonDetail={setReasonDetail}
            onConfirmText={setConfirmText}
            onContinueToConfirm={() => {
              if (!whyHasAnswer) return;
              setDeleteStep("confirm");
              setDeleteError(null);
            }}
            onSubmit={() => void submitDelete()}
            onOpenPortal={() => void openPortal()}
          />
        ) : (
          <>
            {data?.status === "past_due" && (
              <div
                data-testid="billing-past-due-banner"
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: BAD,
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 14,
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Payment past due. Update your card to restore paid features.
              </div>
            )}

            {error && (
              <div style={{ color: BAD, fontSize: 13, marginBottom: 12 }}>{error}</div>
            )}

            {!data && !error && <div style={{ color: SLATE }}>Loading…</div>}

            {data && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                <Row
                  label="Plan"
                  value={data.plan.toUpperCase()}
                  accent={data.plan !== "free"}
                />
                <Row label="Status" value={data.status} />
                {periodLabel && <Row label="Current period ends" value={periodLabel} />}
                <Row
                  label="Card"
                  value={
                    data.cardLast4
                      ? `${data.cardBrand ?? "Card"} ···· ${data.cardLast4}`
                      : "None on file"
                  }
                />
                {data.plan === "free" && (
                  <>
                    <Row
                      label="Design chat left"
                      value={
                        typeof data.designMessagesRemaining === "number"
                          ? `${data.designMessagesRemaining} / ${data.freeDesignLimit ?? "—"}`
                          : "—"
                      }
                    />
                    {typeof data.scansRemaining === "number" && (
                      <Row
                        label="Scans left"
                        value={`${data.scansRemaining} / ${data.freeScanLimit ?? "—"}`}
                      />
                    )}
                  </>
                )}
                <Row
                  label="Repo AI agent"
                  value={data.canUseAiAgent ? "Included" : "Pro / Team"}
                />
                <p style={{ color: SLATE, fontSize: 12, margin: "8px 0 0", lineHeight: 1.5 }}>
                  Cancel anytime. Access continues until{" "}
                  {periodLabel ?? "the end of your billing period"}.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    data-testid="manage-billing-btn"
                    disabled={busy}
                    onClick={() => void openPortal()}
                    style={{
                      background: INK,
                      color: CANVAS,
                      border: "1px solid transparent",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontFamily: FONT_UI,
                      fontWeight: 600,
                      cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    {busy ? "Opening…" : "Manage billing"}
                  </button>
                  {data.plan === "free" && onUpgrade && (
                    <button
                      type="button"
                      data-testid="billing-upgrade-btn"
                      onClick={onUpgrade}
                      style={{
                        background: ACCENT_WASH,
                        color: ACCENT,
                        border: `1px solid ${ACCENT}55`,
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontFamily: FONT_UI,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Upgrade
                    </button>
                  )}
                  {onSignOut && (
                    <button
                      type="button"
                      data-testid="account-sign-out-btn"
                      disabled={signingOut}
                      onClick={() => void handleSignOut()}
                      style={{
                        background: CANVAS,
                        color: INK,
                        border: `1px solid ${LINE}`,
                        borderRadius: 10,
                        padding: "10px 14px",
                        fontFamily: FONT_UI,
                        fontWeight: 600,
                        cursor: signingOut ? "wait" : "pointer",
                        opacity: signingOut ? 0.75 : 1,
                      }}
                    >
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  )}
                </div>
                <p
                  style={{
                    color: SLATE,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    marginTop: 8,
                    lineHeight: 1.5,
                  }}
                >
                  Manage billing opens the Stripe Customer Portal — cancel subscription, update or
                  remove card, view invoices.
                </p>

                {/* Buried delete entry — not a primary button */}
                <div
                  data-testid="account-danger-zone"
                  style={{
                    marginTop: 18,
                    paddingTop: 14,
                    borderTop: `1px solid ${LINE}`,
                  }}
                >
                  {deleteStep === "hidden" && (
                    <button
                      type="button"
                      data-testid="account-trouble-link"
                      onClick={() => setDeleteStep("hint")}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: SLATE,
                        fontSize: 11,
                        fontFamily: FONT_UI,
                        cursor: "pointer",
                        textDecoration: "underline",
                        textUnderlineOffset: 2,
                      }}
                    >
                      Having trouble with your account?
                    </button>
                  )}
                  {deleteStep === "hint" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <p style={{ margin: 0, fontSize: 12, color: SLATE, lineHeight: 1.5 }}>
                        Most issues are fixed by managing billing or signing out and back in. Closing
                        your account permanently removes workspaces and cannot be undone.
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          data-testid="account-keep-btn"
                          onClick={() => setDeleteStep("hidden")}
                          style={{
                            background: PAPER,
                            border: `1px solid ${LINE}`,
                            borderRadius: 8,
                            padding: "6px 10px",
                            fontSize: 12,
                            fontFamily: FONT_UI,
                            cursor: "pointer",
                            color: INK,
                          }}
                        >
                          Never mind
                        </button>
                        <button
                          type="button"
                          data-testid="account-start-delete-btn"
                          onClick={() => setDeleteStep("why")}
                          style={{
                            background: "none",
                            border: "none",
                            padding: "6px 4px",
                            fontSize: 11,
                            fontFamily: FONT_UI,
                            cursor: "pointer",
                            color: SLATE,
                            textDecoration: "underline",
                            textUnderlineOffset: 2,
                          }}
                        >
                          I still want to delete my account…
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DeleteFlow({
  step,
  reasonId,
  reasonDetail,
  confirmText,
  whyHasAnswer,
  confirmReady,
  deleteBusy,
  deleteError,
  plan,
  onBack,
  onCancel,
  onReasonId,
  onReasonDetail,
  onConfirmText,
  onContinueToConfirm,
  onSubmit,
  onOpenPortal,
}: {
  step: "why" | "confirm";
  reasonId: string;
  reasonDetail: string;
  confirmText: string;
  whyHasAnswer: boolean;
  confirmReady: boolean;
  deleteBusy: boolean;
  deleteError: string | null;
  plan?: string;
  onBack: () => void;
  onCancel: () => void;
  onReasonId: (id: string) => void;
  onReasonDetail: (v: string) => void;
  onConfirmText: (v: string) => void;
  onContinueToConfirm: () => void;
  onSubmit: () => void;
  onOpenPortal: () => void;
}) {
  if (step === "why") {
    return (
      <div data-testid="account-delete-why" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: INK, lineHeight: 1.5, fontWeight: 600 }}>
          Before we go further — why are you leaving?
        </p>
        <p style={{ margin: 0, fontSize: 13, color: SLATE, lineHeight: 1.5 }}>
          We read every answer. This step is required; deleting is permanent.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {DELETE_REASONS.map((r) => (
            <label
              key={r.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: reasonId === r.id ? ACCENT_WASH : PAPER,
                border: `1px solid ${reasonId === r.id ? `${ACCENT}55` : LINE}`,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="delete-reason"
                value={r.id}
                checked={reasonId === r.id}
                onChange={() => onReasonId(r.id)}
                data-testid={`delete-reason-${r.id}`}
              />
              {r.label}
            </label>
          ))}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
          <span style={{ color: SLATE }}>
            Tell us a bit more <span style={{ color: BAD }}>(required, 12+ characters)</span>
          </span>
          <textarea
            data-testid="delete-reason-detail"
            value={reasonDetail}
            onChange={(e) => onReasonDetail(e.target.value)}
            rows={3}
            placeholder="What went wrong, or what would have kept you?"
            style={{
              resize: "vertical",
              border: `1px solid ${LINE}`,
              borderRadius: 10,
              padding: "10px 12px",
              fontFamily: FONT_UI,
              fontSize: 13,
              color: INK,
              background: PAPER,
            }}
          />
        </label>
        {plan && plan !== "free" && (
          <p style={{ margin: 0, fontSize: 12, color: SLATE, lineHeight: 1.5 }}>
            On a paid plan? Canceling in{" "}
            <button
              type="button"
              onClick={onOpenPortal}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: ACCENT,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: 12,
                fontFamily: FONT_UI,
              }}
            >
              Manage billing
            </button>{" "}
            stops charges without wiping your account.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button
            type="button"
            data-testid="delete-why-back"
            onClick={onBack}
            style={secondaryBtn}
          >
            Back
          </button>
          <button type="button" onClick={onCancel} style={secondaryBtn}>
            Keep my account
          </button>
          <button
            type="button"
            data-testid="delete-why-continue"
            disabled={!whyHasAnswer}
            onClick={onContinueToConfirm}
            style={{
              ...dangerQuietBtn,
              opacity: whyHasAnswer ? 1 : 0.45,
              cursor: whyHasAnswer ? "pointer" : "not-allowed",
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="account-delete-confirm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, color: INK, lineHeight: 1.5, fontWeight: 600 }}>
        This permanently deletes your account
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          fontSize: 13,
          color: SLATE,
          lineHeight: 1.55,
        }}
      >
        <li>All workspaces and designs are removed</li>
        <li>Billing access ends; open invoices may still be due</li>
        <li>This cannot be undone</li>
      </ul>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <span style={{ color: SLATE }}>
          Type <strong style={{ color: INK }}>DELETE</strong> to confirm
        </span>
        <input
          data-testid="delete-confirm-input"
          value={confirmText}
          onChange={(e) => onConfirmText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="DELETE"
          style={{
            border: `1px solid ${LINE}`,
            borderRadius: 10,
            padding: "10px 12px",
            fontFamily: FONT_MONO,
            fontSize: 13,
            color: INK,
            background: PAPER,
          }}
        />
      </label>
      {deleteError && (
        <div style={{ color: BAD, fontSize: 13, lineHeight: 1.45 }}>{deleteError}</div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" data-testid="delete-confirm-back" onClick={onBack} style={secondaryBtn}>
          Back
        </button>
        <button type="button" onClick={onCancel} style={secondaryBtn}>
          Keep my account
        </button>
        <button
          type="button"
          data-testid="account-delete-submit"
          disabled={!confirmReady || deleteBusy}
          onClick={onSubmit}
          style={{
            background: confirmReady ? BAD : PAPER,
            color: confirmReady ? CANVAS : SLATE,
            border: `1px solid ${confirmReady ? BAD : LINE}`,
            borderRadius: 10,
            padding: "10px 14px",
            fontFamily: FONT_UI,
            fontWeight: 600,
            cursor: confirmReady && !deleteBusy ? "pointer" : "not-allowed",
            opacity: deleteBusy ? 0.7 : 1,
          }}
        >
          {deleteBusy ? "Deleting…" : "Delete my account"}
        </button>
      </div>
    </div>
  );
}

const secondaryBtn: CSSProperties = {
  background: CANVAS,
  color: INK,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: "10px 14px",
  fontFamily: FONT_UI,
  fontWeight: 600,
  cursor: "pointer",
};

const dangerQuietBtn: CSSProperties = {
  background: CANVAS,
  color: BAD,
  border: `1px solid #FECACA`,
  borderRadius: 10,
  padding: "10px 14px",
  fontFamily: FONT_UI,
  fontWeight: 600,
};

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 12px",
        background: PAPER,
        border: `1px solid ${LINE}`,
        borderRadius: 10,
      }}
    >
      <span style={{ color: SLATE }}>{label}</span>
      <span
        data-testid={`billing-${label.toLowerCase().replace(/\s+/g, "-")}`}
        style={{ fontWeight: 600, color: accent ? ACCENT : INK }}
      >
        {value}
      </span>
    </div>
  );
}
