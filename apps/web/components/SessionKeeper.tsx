"use client";

import { useEffect } from "react";
import { startSessionKeeper } from "../lib/api";

/** Keeps the login alive while the user is working (see startSessionKeeper). */
export function SessionKeeper() {
  useEffect(() => startSessionKeeper(), []);
  return null;
}
