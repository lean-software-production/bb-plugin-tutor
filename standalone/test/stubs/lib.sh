#!/bin/sh
# standalone/test/stubs/lib.sh — shared plumbing, sourced by every stub.
#
# stub_init <name> "$@" logs argv to $STUB_LOG/<name> and, when <name> is
# listed (space-separated) in STUB_MISSING, exits 127 as a missing command
# would, so check_prereqs sees it as absent.

stub_init() {
  stub_name=$1
  shift
  printf '%s\n' "$*" >>"$STUB_LOG/$stub_name"
  case " ${STUB_MISSING:-} " in
    *" $stub_name "*)
      echo "$stub_name: command not found" >&2
      exit 127
      ;;
  esac
}
