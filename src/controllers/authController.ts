import { Request, Response } from 'express';

export const login = (req: Request, res: Response): void => {
    const { email, password } = req.body;

    // Add your authentication logic here (e.g., DB lookup, bcrypt verify)
    if (email === "user@example.com" && password === "password123") {
        res.status(200).json({ message: "Login successful!" });
    } else {
        res.status(401).json({ message: "Invalid credentials" });
    }
};