extends SceneTree
## Runs every test_*.gd in res://tests: each test_* function of each, with a
## fresh instance. A test fails by calling check(false, message) — it is told
## through `failures`. Without a window:
##   godot --headless --path godot --script res://tests/run_tests.gd
## [-- --only=<file name part>]
## The tests run on the first frame, once the tree is up: a test can put
## nodes in it (tree.root) and read where they are in the world.

var _done := false


func _process(_delta: float) -> bool:
	if _done:
		return false
	_done = true
	var only := ""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--only="):
			only = argument.get_slice("=", 1)
	var passed := 0
	var failed := 0
	var dir := DirAccess.open("res://tests")
	var files := Array(dir.get_files()).filter(func(f: String) -> bool: return f.begins_with("test_") and f.ends_with(".gd") and (only.is_empty() or only in f))
	files.sort()
	for file in files:
		var script: GDScript = load("res://tests/" + file)
		if script == null or not script.can_instantiate():
			failed += 1
			print("✖ %s ne compile pas" % file)
			continue
		for method in script.get_script_method_list():
			var test_name: String = method.name
			if not test_name.begins_with("test_"):
				continue
			var case: Object = script.new()
			case.set("tree", self)
			case.call(test_name)
			var failures: Array = case.get("failures")
			if failures.is_empty():
				passed += 1
				print("✔ %s › %s" % [file.get_basename(), test_name])
			else:
				failed += 1
				print("✖ %s › %s" % [file.get_basename(), test_name])
				for failure in failures:
					print("    " + str(failure))
			if case is Node:
				case.free()
	print("%d réussis, %d échoués" % [passed, failed])
	quit(1 if failed else 0)
	return false
