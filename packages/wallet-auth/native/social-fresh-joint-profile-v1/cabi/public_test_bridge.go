//go:build social_joint_data_test

package main
/*
int public_social_cabi_scenario(int which);
*/
import "C"
func publicScenario(which int)int{return int(C.public_social_cabi_scenario(C.int(which)))}
