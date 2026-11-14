#!/bin/sh
# One CI entry; the two focused drivers remain independently replayable.
set -eu
test "$#" -eq 1
umask 077
mkdir "$1"
test_dir=$(dirname "$0")
/usr/bin/python3 "$test_dir/test_production_startup_admission.py" "$1/startup"
/usr/bin/python3 "$test_dir/test_qualification_failure_delta.py" "$1/qualification"
