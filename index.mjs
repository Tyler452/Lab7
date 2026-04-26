import 'dotenv/config';

import bcrypt from 'bcrypt';
import express from 'express';
import mysql from 'mysql2/promise';
import session from 'express-session';
const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

//for Express to get values using the POST method
app.use(express.urlencoded({ extended: true }));
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'lab7-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60
        }
    })
);

app.use((req, res, next) => {
    res.locals.isAuthenticated = Boolean(req.session?.isAuthenticated);
    res.locals.currentUser = req.session?.username || null;
    next();
});

//setting up database connection pool, replace values in red
const pool = mysql.createPool({
    host: process.env.HOST_NAME,
    user: process.env.USER_NAME,
    password: process.env.PASSWORD,
    database: process.env.DATABASE,
    connectionLimit: 10,
    waitForConnections: true
});

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const requireAuth = (req, res, next) => {
    if (req.session?.isAuthenticated) {
        return next();
    }

    res.redirect('/login');
};

const getAuthors = async () => {
    const sql = `
        SELECT authorId, firstName, lastName
        FROM authors
        ORDER BY lastName, firstName
    `;
    const [authors] = await pool.query(sql);
    return authors;
};

const getCategories = async () => {
    const sql = `
        SELECT DISTINCT category
        FROM quotes
        WHERE category IS NOT NULL AND TRIM(category) <> ''
        ORDER BY category
    `;
    const [categories] = await pool.query(sql);
    return categories;
};

const ensureAdminUser = async () => {
    const passwordHash = process.env.ADMIN_PASSWORD_HASH || '$2b$10$Btn711TD3X9JYx7ngJvMtuIE/ew68Cl8qrBy10mRDfRBy.2wB9l3C';

    const createSql = `
        CREATE TABLE IF NOT EXISTS admin_users (
            userId INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL
        )
    `;
    await pool.query(createSql);

    const insertSql = `
        INSERT INTO admin_users (username, password)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE password = VALUES(password)
    `;
    await pool.query(insertSql, ['admin', passwordHash]);
};
//routes
app.get('/login', (req, res) => {
    if (req.session?.isAuthenticated) {
        return res.redirect('/');
    }

    res.render('login.ejs', { error: null });
});

app.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    const sql = `
        SELECT password
        FROM admin_users
        WHERE username = ?
    `;
    const [rows] = await pool.query(sql, [username]);

    const matchingUser = rows[0];
    const isValidPassword = matchingUser
        ? await bcrypt.compare(password, matchingUser.password)
        : false;

    if (!isValidPassword) {
        return res.status(401).render('login.ejs', {
            error: 'Invalid username or password.'
        });
    }

    req.session.isAuthenticated = true;
    req.session.username = username;
    res.redirect('/');
}));

app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

app.get('/', requireAuth, (req, res) => {
    res.render('home.ejs');
});

app.get('/authors', requireAuth, asyncHandler(async (req, res) => {
    const sql = `
        SELECT authorId, firstName, lastName, country, profession
        FROM authors
        ORDER BY lastName, firstName
    `;
    const [authors] = await pool.query(sql);
    res.render('authors.ejs', { authors });
}));

app.get('/addAuthor', requireAuth, (req, res) => {
    res.render('addAuthor.ejs', { error: null, authorForm: {} });
});

app.post('/addAuthor', requireAuth, asyncHandler(async (req, res) => {
    const {
        firstName,
        lastName,
        sex,
        dob,
        dod,
        profession,
        country,
        bio,
        pictureUrl
    } = req.body;

    if (!firstName || !lastName || !sex || !dob || !profession || !country || !bio || !pictureUrl) {
        return res.status(400).render('addAuthor.ejs', {
            error: 'All author fields are required.',
            authorForm: req.body
        });
    }

    const sql = `
        INSERT INTO authors
        (firstName, lastName, dob, dod, sex, profession, country, portrait, biography)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        firstName,
        lastName,
        dob,
        dod || null,
        sex,
        profession,
        country,
        pictureUrl,
        bio
    ];
    await pool.query(sql, params);

    res.redirect('/authors');
}));

app.get('/updateAuthor', requireAuth, asyncHandler(async (req, res) => {
    const authorId = req.query.authorId;
    const sql = `
        SELECT
            authorId,
            firstName,
            lastName,
            sex,
            profession,
            country,
            portrait,
            biography,
            DATE_FORMAT(dob, '%Y-%m-%d') AS ISOdob,
            DATE_FORMAT(dod, '%Y-%m-%d') AS ISOdod
        FROM authors
        WHERE authorId = ?
    `;
    const [authorInfo] = await pool.query(sql, [authorId]);

    if (authorInfo.length === 0) {
        return res.status(404).send('Author not found');
    }

    res.render('updateAuthor.ejs', { authorInfo, error: null });
}));

app.post('/updateAuthor', requireAuth, asyncHandler(async (req, res) => {
    const {
        authorId,
        firstName,
        lastName,
        sex,
        dob,
        dod,
        profession,
        country,
        portrait,
        bio
    } = req.body;

    const sql = `
        UPDATE authors
        SET firstName = ?, lastName = ?, sex = ?, dob = ?, dod = ?, profession = ?, country = ?, portrait = ?, biography = ?
        WHERE authorId = ?
    `;
    const params = [firstName, lastName, sex, dob, dod || null, profession, country, portrait, bio, authorId];
    await pool.query(sql, params);

    res.redirect('/authors');
}));

app.post('/deleteAuthor', requireAuth, asyncHandler(async (req, res) => {
    const { authorId } = req.body;
    const sql = `DELETE FROM authors WHERE authorId = ?`;
    await pool.query(sql, [authorId]);
    res.redirect('/authors');
}));

app.get('/quotes', requireAuth, asyncHandler(async (req, res) => {
    const sql = `
        SELECT
            q.quoteId,
            q.quote,
            q.category,
            q.authorId,
            a.firstName,
            a.lastName
        FROM quotes q
        LEFT JOIN authors a ON q.authorId = a.authorId
        ORDER BY q.quoteId DESC
    `;
    const [quotes] = await pool.query(sql);
    res.render('quotes.ejs', { quotes });
}));

app.get('/addQuote', requireAuth, asyncHandler(async (req, res) => {
    const [authors, categories] = await Promise.all([getAuthors(), getCategories()]);
    res.render('addQuotes.ejs', {
        authors,
        categories,
        error: null,
        quoteForm: {}
    });
}));

app.post('/addQuote', requireAuth, asyncHandler(async (req, res) => {
    const { quote, authorId, category, newCategory } = req.body;
    const selectedCategory = newCategory?.trim() || category?.trim();

    if (!quote || !authorId || !selectedCategory) {
        const [authors, categories] = await Promise.all([getAuthors(), getCategories()]);
        return res.status(400).render('addQuotes.ejs', {
            authors,
            categories,
            error: 'Quote, author, and category are required.',
            quoteForm: req.body
        });
    }

    const sql = `INSERT INTO quotes (quote, authorId, category) VALUES (?, ?, ?)`;
    await pool.query(sql, [quote, authorId, selectedCategory]);
    res.redirect('/quotes');
}));

app.get('/updateQuote', requireAuth, asyncHandler(async (req, res) => {
    const quoteId = req.query.quoteId;
    const sql = `SELECT quoteId, quote, authorId, category FROM quotes WHERE quoteId = ?`;
    const [quoteInfo] = await pool.query(sql, [quoteId]);

    if (quoteInfo.length === 0) {
        return res.status(404).send('Quote not found');
    }

    const [authors, categories] = await Promise.all([getAuthors(), getCategories()]);
    res.render('updateQuote.ejs', { quoteInfo, authors, categories });
}));

app.post('/updateQuote', requireAuth, asyncHandler(async (req, res) => {
    const { quoteId, quote, authorId, category, newCategory } = req.body;
    const selectedCategory = newCategory?.trim() || category?.trim();

    const sql = `UPDATE quotes SET quote = ?, authorId = ?, category = ? WHERE quoteId = ?`;
    await pool.query(sql, [quote, authorId, selectedCategory, quoteId]);
    res.redirect('/quotes');
}));

app.post('/deleteQuote', requireAuth, asyncHandler(async (req, res) => {
    const { quoteId } = req.body;
    const sql = `DELETE FROM quotes WHERE quoteId = ?`;
    await pool.query(sql, [quoteId]);
    res.redirect('/quotes');
}));

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
});

await ensureAdminUser();

app.listen(3000, () => {
    console.log("Express server running")
})
