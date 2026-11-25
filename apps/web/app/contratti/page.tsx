"use client";

import { useEffect, useState } from "react";
import { SectionShell } from "../../components/SectionShell";
import { FleetContracts } from "../../components/FleetContracts";
import { useLanguage } from "../../components/LanguageProvider";
import { getAccessToken, hasPermission } from "../../lib/api";

export default function ContrattiPage() {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [creating, setCreating] = useState(0);

  useEffect(() => {
    setSignedIn(Boolean(getAccessToken()));
    setCanWrite(hasPermission("customer.write"));
  }, []);

  const actions = signedIn && canWrite ? <button className="primary" onClick={() => setCreating((n) => n + 1)}>{t("+ Nuovo contratto")}</button> : null;

  return (
    <SectionShell title={t("Contratti flotta")} eyebrow={t("FLOTTE AZIENDALI")} actions={actions}>
      {!signedIn ? (
        <div className="empty-state">{t("Accedi per gestire i contratti.")} <a href="/login">{t("Accedi")}</a></div>
      ) : (
        <>
          <FleetContracts creating={creating} />
        </>
      )}
    </SectionShell>
  );
}
