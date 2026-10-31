import { toast as hotToast } from "react-hot-toast";

// Every toast in the app, shown by components/Toaster.jsx. Besides react-hot-toast's options (id, duration), a toast
// takes a description, a second line, and an action, { label, onClick, shortcut }: a button that closes the toast and
// runs onClick, with the keys that do the same after its label (lib/keyboard.js), except on touch screens.
export const toast = {
	message: hotToast,
	success: hotToast.success,
	error: hotToast.error,
	loading: hotToast.loading,
	promise: hotToast.promise,
	dismiss: hotToast.dismiss,
};
