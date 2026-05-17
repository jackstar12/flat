import type { HouseholdConfig, Roommate } from "./types";

export const household: HouseholdConfig = {
  id: "wg-main",
  name: "Hugo-Wolf-Gang",
  currency: "EUR",
};

export const roommates: Roommate[] = [
  { id: "kran", name: "Kran", initials: "KR", color: "#e66a4e" },
  { id: "stadlmann", name: "Stadlmann", initials: "ST", color: "#2f5d50" },
  { id: "mitter", name: "Mitter", initials: "MIT", color: "#5277c3" },
];

export const roommateIds = roommates.map((roommate) => roommate.id);

export const receiptAssignmentPrompt = `Kran:

Stadlmann:
Viel Kase

Mitter:

Allgemein:
Eier equal split
Bier: 60% Mitter, 30% Stadlmann, 10% Kran`;

export function findRoommate(roommateId: string): Roommate | undefined {
  return roommates.find((roommate) => roommate.id === roommateId);
}

export function assertRoommate(roommateId: string): Roommate {
  const roommate = findRoommate(roommateId);
  if (!roommate) {
    throw new Error(`Unknown roommate: ${roommateId}`);
  }
  return roommate;
}
