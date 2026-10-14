-- M8.3 (A-232): a transfer makes a contract of its own type for the customer who receives the sessions. A new value of an
-- enum cannot be used in the transaction that adds it, so it is added alone, before the migration that uses it.
ALTER TYPE "ContractType" ADD VALUE 'TRANSFER';
