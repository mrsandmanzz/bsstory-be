export type Role = 'user' | 'admin';
export type BookStatus = 'draft' | 'published' | 'archived';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

export interface Book {
  id: string;
  slug: string;
  title: string;
  author: string;
  summary: string;
  ageMin: number;
  ageMax: number;
  /** Price in whole currency units (IDR has no minor unit). 0 = free book. */
  price: number;
  status: BookStatus;
  /** Number of leading pages anyone may read without access. */
  previewPages: number;
  coverEmoji: string;
  /** Optional illustration (path or https URL). UI falls back to emoji + gradient when absent/broken. */
  coverUrl: string | null;
  coverFrom: string;
  coverTo: string;
  readingMinutes: number;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
}

import type { PageActivity } from './activity.js';

export interface BookPage {
  position: number; // 1-based
  text: string;
  emoji: string;
  imageUrl: string | null;
  /** Stickers and an optional question. Delivered with the page, so it is gated exactly like the text. */
  activity: PageActivity | null;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** True during the free-trial period: access is granted, nothing has been charged yet. */
  trial: boolean;
}

export type SubscriptionState = 'none' | 'active' | 'ending' | 'expired';

export interface Purchase {
  id: string;
  userId: string;
  bookId: string;
  paymentId: string;
  amount: number;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  interval: 'month' | 'year';
  price: number;
  days: number;
  tagline: string;
}

export interface Payment {
  id: string;
  userId: string;
  kind: 'subscription' | 'book';
  refId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  failureReason: string | null;
  idempotencyKey: string | null;
  last4: string | null;
  createdAt: string;
}
