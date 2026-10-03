#include <stdio.h>
#include <string.h>
#include <sodium.h>
int main(void) {
  if (sodium_init() < 0) return 1;
  printf("header=%s runtime=%s\n", SODIUM_VERSION_STRING, sodium_version_string());
  return strcmp(SODIUM_VERSION_STRING, "1.0.22") || strcmp(sodium_version_string(), "1.0.22");
}
