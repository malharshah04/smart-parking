"use client";

import { useState, useEffect } from "react";
import {
  collection, onSnapshot, query, where,
  addDoc, updateDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";

import type { ParkingSite, ParkingSlot, Booking } from "@/types";

// 🔥 FINAL LOCK
const REAL_LOT_ID = "p022";
const REAL_SLOT_ID = "A1";

// ─── Parking Sites ────────────────────────────────────────────────────────────
export function useParkingSites() {
  const [sites, setSites] = useState<ParkingSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "parkingSites"),
      (snap) => {
        setSites(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ParkingSite)));
        setLoading(false);
      },
      (err) => { setError(err.message); setLoading(false); }
    );
    return () => unsub();
  }, []);

  return { sites, loading, error };
}

// ─── 🔴 ONLY REAL SLOT (A1) FROM ESP ──────────────────────────────────────────
export function useRealSlots(parkingId: string | null) {
  const [slots, setSlots] = useState<ParkingSlot[] | null>(null);
  const [loading, setLoading] = useState(true);

  const isRealLot = parkingId === REAL_LOT_ID;

  useEffect(() => {
    if (!isRealLot) {
      setSlots(null);
      setLoading(false);
      return;
    }

    const slotRef = ref(rtdb, `parking/${REAL_LOT_ID}/${REAL_SLOT_ID}`);

    const unsub = onValue(slotRef, (snap) => {
      const v = snap.val();

      if (!v) {
        setSlots([]);
        setLoading(false);
        return;
      }

      setSlots([
        {
          id: REAL_SLOT_ID,
          slotId: REAL_SLOT_ID,
          parkingId: REAL_LOT_ID,
          occupied: v.status === "OCCUPIED",
          reserved: false,
          distance: v.distance,
          isLive: true,
        },
      ]);

      setLoading(false);
    });

    return () => unsub();
  }, [isRealLot]);

  return { slots, loading, isRealLot };
}

// ─── BOOKINGS (unchanged) ─────────────────────────────────────────────────────
export function useLotBookings(parkingId: string | null) {
  const [bookedSlotIds, setBookedSlotIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!parkingId) { setLoading(false); return; }

    const q = query(
      collection(db, "bookings"),
      where("parkingId", "==", parkingId),
      where("status", "==", "active")
    );

    const unsub = onSnapshot(q, (snap) => {
      const booked = new Set<string>(
        snap.docs.map((d) => d.data().slotId as string)
      );
      setBookedSlotIds(booked);
      setLoading(false);
    });

    return () => unsub();
  }, [parkingId]);

  return { bookedSlotIds, loading };
}

// ─── OTHER FUNCTIONS (unchanged) ──────────────────────────────────────────────
export async function createBooking(booking: Omit<Booking, "id" | "createdAt">) {
  const docRef = await addDoc(collection(db, "bookings"), {
    ...booking,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function cancelBooking(bookingId: string) {
  await updateDoc(doc(db, "bookings", bookingId), { status: "cancelled" });
}

export function useLotBookedCount(parkingId: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!parkingId) return;
    const q = query(
      collection(db, "bookings"),
      where("parkingId", "==", parkingId),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(q, (snap) => setCount(snap.size));
    return () => unsub();
  }, [parkingId]);

  return count;
}

// ─── USER BOOKINGS (for history page) ────────────────────────────────────────
export function useBookings(userId: string | null) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }

    const q = query(
      collection(db, "bookings"),
      where("userId", "==", userId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
        // Sort newest first
        data.sort((a, b) => {
          const ta = (a.createdAt as any)?.seconds ?? 0;
          const tb = (b.createdAt as any)?.seconds ?? 0;
          return tb - ta;
        });
        setBookings(data);
        setLoading(false);
      },
      (err) => { setError(err.message); setLoading(false); }
    );

    return () => unsub();
  }, [userId]);

  return { bookings, loading, error };
}

// ─── AUTO CHECKOUT ────────────────────────────────────────────────────────────
// Watches active bookings for a user and auto-cancels if the slot becomes FREE
// (i.e. car has left). Call this once the user has an active booking.
export function useAutoCheckout(userId: string | null) {
  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, "bookings"),
      where("userId",   "==", userId),
      where("status",   "==", "active")
    );

    const unsub = onSnapshot(q, (snap) => {
      snap.docs.forEach(async (bookingDoc) => {
        const booking = bookingDoc.data();

        // Only auto-checkout real ESP32 slot
        if (booking.parkingId !== REAL_LOT_ID || booking.slotId !== REAL_SLOT_ID) return;

        const slotRef = ref(rtdb, `parking/${REAL_LOT_ID}/${REAL_SLOT_ID}`);
        onValue(slotRef, async (snap) => {
          const v = snap.val();
          if (v && v.status === "FREE") {
            await updateDoc(doc(db, "bookings", bookingDoc.id), {
              status: "completed",
              checkoutAt: serverTimestamp(),
            });
          }
        }, { onlyOnce: true });
      });
    });

    return () => unsub();
  }, [userId]);
}