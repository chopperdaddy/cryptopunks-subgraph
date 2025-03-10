/**
 * @file helpers.ts
 * @description This file contains utility functions for the CryptoPunks subgraph.
 */

import { BigInt, Bytes, ethereum, log, store } from '@graphprotocol/graph-ts';

import { Account, Bid, Event, Listing, Punk, State, Transfer } from '../../generated/schema';

import { Transfer as TransferEvent, } from '../../generated/CryptoPunksMarket/CryptoPunksMarket';

import { timestampToId } from './date-utils';
import { BIGINT_ZERO, ZERO_ADDRESS } from './constants';
import { BIGINT_ONE } from './constants';

/**
 * Generates a global ID for an event.
 * @param event - The ethereum event.
 * @returns A string representing the global ID.
 */
export function getGlobalId(event: ethereum.Event): string {
	let globalId = event.transaction.hash
		.toHexString()
		.concat('-')
		.concat(event.logIndex.toString());
	return globalId;
}

/**
 * Gets or creates a Transfer entity.
 * @param event - The TransferEvent.
 * @returns The Transfer entity.
 */
export function getOrCreateTransfer(event: TransferEvent): Transfer {
	let transferId = event.transaction.hash.toHexString();

  let transfer = Transfer.load(transferId);
  if (!transfer) {
    transfer = new Transfer(transferId);
    transfer.from = event.params.from.toHexString();
    transfer.to = event.params.to.toHexString();
    transfer.transactionHash = event.transaction.hash;
    transfer.save();
  }

	return transfer;
}

/**
 * Gets or creates an Account entity.
 * @param id - The account ID.
 * @param createIfNotFound - Whether to create the account if not found.
 * @param save - Whether to save the account after creation.
 * @returns The Account entity.
 */
export function getOrCreateAccount(
  id: string,
  createIfNotFound: boolean = true,
  save: boolean = true,
): Account {
  let account = Account.load(id);

  if (account == null && createIfNotFound) {
    account = new Account(id);
    account.punks = [];
    if (save) account.save();
  }

  return account as Account;
}

/**
 * Gets or creates a Punk entity.
 * @param id - The punk ID.
 * @param createIfNotFound - Whether to create the punk if not found.
 * @param save - Whether to save the punk after creation.
 * @returns The Punk entity.
 */
export function getOrCreatePunk(
  id: string,
  createIfNotFound: boolean = true,
  save: boolean = true,
): Punk {

  let punk = Punk.load(id);
  if (punk == null && createIfNotFound) {
    punk = new Punk(id);
    punk.owner = ZERO_ADDRESS;
    punk.wrapped = false;
    if (save) punk.save();
  }

  return punk as Punk;
}

/**
 * Gets or creates a State entity.
 * @param timestamp - The timestamp for the state.
 * @returns The State entity.
 */
export function getOrCreateState(timestamp: BigInt): State {
  let ts = timestamp.toI32();

  let id = timestampToId(ts);

  let i = 1;
  let prevState: State | null = null;
  
  do {
    let prevId = timestampToId(ts, i);
    prevState = State.load(prevId) as State | null;
    i++;
  } while (!prevState && i <= 30);
  

  let prevListings: string[] = [];
  let prevOwners: BigInt = BIGINT_ZERO;

  if (prevState) {
    prevListings = prevState.activeListings;
    prevOwners = prevState.owners;
  }

  let state = State.load(id);
  if (state == null) {
    state = new State(id);
    state.timestamp = timestamp;
    state.topBid = null;
    state.topSale = null;
    state.listings = BIGINT_ZERO;
    state.delistings = BIGINT_ZERO;
    state.bids = BIGINT_ZERO;
    state.sales = BIGINT_ZERO;
    state.volume = BIGINT_ZERO;
    state.floor = BIGINT_ZERO;
    // These carry over from previous state
    state.owners = prevOwners;
    state.activeListings = prevListings;

    if (prevListings.length > 0) {
      let newFloor = getFloorFromActiveListings(state);
      state.floor = newFloor;
    }
  }

  return state as State;
}

let updateOwnershipPunkId: string;
/**
 * Updates the ownership of a punk.
 * @param transactionHash - The transaction hash.
 * @param blockTimestamp - The block timestamp.
 * @param punkId - The punk ID.
 * @param toAddress - The new owner's address.
 * @param fromAddress - The previous owner's address.
 */
export function updateOwnership(
  transactionHash: Bytes,
  blockTimestamp: BigInt,
  punkId: string,
  toAddress: string,
  fromAddress: string,
): void {

  updateOwnershipPunkId = punkId;

  let toAccount = getOrCreateAccount(toAddress);
  let fromAccount = getOrCreateAccount(fromAddress);

  let toHolderPunks = toAccount.punks;
  let fromHolderPunks = fromAccount.punks;

  let state = getOrCreateState(blockTimestamp);
  let prevOwners = state.owners;

  if (fromHolderPunks.length == 1) {
    prevOwners = prevOwners.minus(BIGINT_ONE);
  }

  if (toHolderPunks.length == 0) {
    prevOwners = prevOwners.plus(BIGINT_ONE);
  }

  state.owners = prevOwners;
  state.save();
  
  let newFromHolderPunks = fromHolderPunks.filter(n => n != updateOwnershipPunkId);
  fromAccount.punks = newFromHolderPunks;
  toHolderPunks.push(updateOwnershipPunkId);
  toAccount.punks = toHolderPunks;

  fromAccount.save();
  toAccount.save();

  let punk = getOrCreatePunk(updateOwnershipPunkId);
  punk.owner = toAccount.id;
  punk.save();

  log.debug(`updateOwnership(): TXHash: {}, PunkID: {}, ToPunks: {}, FromPunks: {}`, [
    transactionHash.toHexString(),
    updateOwnershipPunkId,
    toHolderPunks.length.toString(),
    fromHolderPunks.length.toString(),
  ]);
}

/**
 * Gets the owner of a punk.
 * @param punkId - The punk ID.
 * @returns The owner's address.
 */
export function getPunkOwner(punkId: string): string {
  let punk = Punk.load(punkId);
  if (punk) {
    let owner = Account.load(punk.owner);
    if (owner) return owner.id.toString() || ZERO_ADDRESS;
  }
  return ZERO_ADDRESS;
}

/**
 * Loads the previous bid event.
 * @param topBid - The top bid ID.
 * @returns The Event entity or null.
 */
export function loadPrevBidEvent(topBid: string | null): Event | null {
  if (topBid == null) return null;
  return Event.load(topBid as string) || null;
}

/**
 * Loads the previous sale event.
 * @param topSale - The top sale ID.
 * @returns The Event entity or null.
 */
export function loadPrevSaleEvent(topSale: string | null): Event | null {
  if (topSale == null) return null;
  return Event.load(topSale as string) || null;
}

/**
 * Calculates the floor price from active listings.
 * @param state - The State entity.
 * @returns The floor price as a BigInt.
 */
export function getFloorFromActiveListings(state: State): BigInt {

  let prevId = timestampToId(state.timestamp.toI32(), 1);
  let prevState = State.load(prevId);

  let prevFloor: BigInt = BIGINT_ZERO;
  if (prevState) prevFloor = prevState.floor;

  let listings = state.activeListings;
  if (listings.length < 5) return prevFloor;

  let newFloor: BigInt | null = null;

  for (let i = 0; i < listings.length; i++) {
    let listing = Listing.load(listings[i]);
    if (listing && listing.value && listing.value.gt(BIGINT_ZERO)) {
      // log.info('listing value: {}', [listing.value.toString()]);
      if (newFloor === null || listing.value.lt(newFloor)) {
        newFloor = listing.value;
      }
    }
  }

  return newFloor ? newFloor : BIGINT_ZERO;
}

/**
 * Removes a punk from sale and optionally removes its bid.
 * @param punkId - The punk ID.
 * @param removeBid - Whether to remove the bid as well.
 */
export function setPunkNoLongerForSale(punkId: string, removeBid: boolean = false): void {
  let listing = Listing.load(punkId);
  if (listing) store.remove('Listing', punkId);

  if (removeBid) {
    let bid = Bid.load(punkId);
    if (bid) store.remove('Bid', punkId);
  }
}
  
/**
 * Converts a hexadecimal string to a decimal BigInt.
 * @param hexString - The hexadecimal string to convert.
 * @returns The decimal value as a BigInt.
 */
export function hexToDecimal(hexString: string): BigInt {
  let hexDigits = "0123456789abcdef";
  let decimal = BigInt.fromI32(0);

  hexString = hexString.toLowerCase();
  let start = hexString.startsWith("0x") ? 2 : 0;
  let hexLength = hexString.length;

  for (let i = start; i < hexLength; i++) {
    decimal = decimal.times(BigInt.fromI32(16)).plus(BigInt.fromI32(hexDigits.indexOf(hexString.charAt(i))));
  }
  
  return decimal;
}
