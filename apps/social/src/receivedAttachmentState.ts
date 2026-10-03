export type ReceivedAttachment<Client, Target> = Readonly<{
  client: Client;
  eventId: string;
  target: Target;
}>;

export function captureReceivedAttachment<Client, Target>(client: Client, eventId: string,
  target: Target): ReceivedAttachment<Client, Target> {
  return Object.freeze({ client, eventId, target });
}

// This check runs during render, not after the old modal has committed.
export function receivedAttachmentInScope<Client, Target>(original: ReceivedAttachment<Client, Target> | undefined,
  client: Client, eventId: string): ReceivedAttachment<Client, Target> | undefined {
  return original?.client === client && original.eventId === eventId ? original : undefined;
}

// A delayed close from an old modal cannot clear a newly selected attachment,
// even when the client and event ID happen to be identical.
export function completeReceivedAttachment<Client, Target>(current: ReceivedAttachment<Client, Target> | undefined,
  completed: ReceivedAttachment<Client, Target>): ReceivedAttachment<Client, Target> | undefined {
  return current === completed ? undefined : current;
}
