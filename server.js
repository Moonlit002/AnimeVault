require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('CRITICAL ERROR: SUPABASE_URL or SUPABASE_KEY is missing in .env file!');
    console.log('Current SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.log('Current SUPABASE_KEY:', supabaseKey ? 'Set' : 'Missing');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Test Supabase connection
async function testConnection() {
    try {
        const { data, error } = await supabase.from('products').select('count', { count: 'exact', head: true });
        if (error) throw error;
        console.log('Supabase connection successful. Products count:', data);
    } catch (error) {
        console.error('Supabase connection failed:', error.message);
    }
}
testConnection();

// --- FIX 1: MUST PUT THESE FIRST ---
app.use(cors({
    origin: '*', // This allows all devices to talk to your API
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- ROUTES ---

// 1. Limited Items
app.get('/api/limited-items', async (req, res) => {
    const { data, error } = await supabase.from('limited_items').select('*');
    if (error) return res.status(500).json({ error: error.message });
    
    // Map database columns to frontend keys
    const mappedData = data.map(item => ({
        id: item.item_name, // Always use item_name as ID for frontend consistency
        name: item.item_name,
        image: item.image_url,
        price: item.price || 0
    }));
    res.json(mappedData);
});

app.post('/api/limited-items', async (req, res) => {
    const item = req.body;
    
    // Map frontend keys to database columns
    const dbItem = {
        item_name: item.name,
        image_url: item.image,
        price: item.price
    };
    
    // If the name was changed (item.id exists and is different from item.name),
    // we should delete the old record first because item_name is our unique identifier.
    if (item.id && item.id !== item.name) {
        await supabase.from('limited_items').delete().eq('item_name', item.id);
    }
    
    // If table has no 'id' column, we use item_name as the conflict target for upsert
    const { data, error } = await supabase
        .from('limited_items')
        .upsert(dbItem, { onConflict: 'item_name' });
        
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Limited item saved!', data });
});

app.delete('/api/limited-items/:id', async (req, res) => {
    const { id } = req.params;
    
    // Since we know limited_items uses item_name as identifier and has no id column
    const { data, error } = await supabase.from('limited_items').delete().eq('item_name', id);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Limited item deleted!', data });
});

// 2. Regular Products
app.get('/api/products', async (req, res) => {
    const { data, error } = await supabase.from('products').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/products', async (req, res) => {
    const products = req.body;
    const { data, error } = await supabase.from('products').upsert(products); 
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Data saved to Supabase successfully' });
});

app.put('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    
    // Ensure id is not in updates if it's the primary key
    delete updates.id;
    
    const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Product updated successfully', data });
});

app.delete('/api/products/:id', async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase.from('products').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Product deleted from Supabase' });
});

// 3. Admins (Fetch all - used for some internal logic if needed)
app.get('/api/admins', async (req, res) => {
    const { data, error } = await supabase.from('admins').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// 4. Admin Login (Secure verification)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const { data, error } = await supabase
            .from('admins')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .single();

        if (error || !data) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Return user data (excluding password if you wanted to be more secure)
         const { password: _, ...adminData } = data;
         res.json(adminData);
     } catch (err) {
         res.status(500).json({ error: 'Internal server error' });
     }
 });
 
 // 5. User Registration
 app.post('/api/register', async (req, res) => {
     const { username, password, email, name } = req.body;
 
     if (!username || !password || !email) {
         return res.status(400).json({ error: 'Username, password, and email are required' });
     }
 
     try {
         // Check if user already exists
         const { data: existingUser } = await supabase
             .from('users')
             .select('username')
             .eq('username', username)
             .single();
 
         if (existingUser) {
             return res.status(400).json({ error: 'Username already exists' });
         }
 
         const { data, error } = await supabase
             .from('users')
             .insert([{ username, password, email, name: name || username }])
             .select();
 
         if (error) throw error;
         res.status(201).json({ message: 'User registered successfully', user: data[0] });
     } catch (err) {
         res.status(500).json({ error: err.message });
     }
 });
 
 // 6. User Login
 app.post('/api/user-login', async (req, res) => {
     const { username, password } = req.body;
 
     if (!username || !password) {
         return res.status(400).json({ error: 'Username and password are required' });
     }
 
     try {
         const { data, error } = await supabase
             .from('users')
             .select('*')
             .eq('username', username)
             .eq('password', password)
             .single();
 
         if (error || !data) {
             return res.status(401).json({ error: 'Invalid username or password' });
         }
 
         const { password: _, ...userData } = data;
         res.json(userData);
     } catch (err) {
         res.status(500).json({ error: 'Internal server error' });
     }
 });
 
 // 7. Orders API
app.get('/api/users', async (req, res) => {
    try {
        const { data, error } = await supabase.from('users').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/orders', async (req, res) => {
    const { userId, userName } = req.query;
    console.log(`Fetching orders for userId: ${userId}, userName: ${userName}`);
    let query = supabase.from('orders').select('*');
    
    if (userId) {
        const customerList = [userId];
        if (userName) customerList.push(userName);
        query = query.in('customers', customerList);
    }
    
    const { data, error } = await query.order('date', { ascending: false });
    if (error) {
        console.error('Error fetching orders:', error);
        return res.status(500).json({ error: error.message });
    }
    console.log(`Found ${data.length} orders`);
    
    // Map 'customers' back to 'customer' for frontend compatibility
    const mappedData = data.map(order => ({
        ...order,
        customer: order.customers
    }));
    
    res.json(mappedData);
});

app.post('/api/orders', async (req, res) => {
    const orders = req.body;
    const ordersToInsert = Array.isArray(orders) ? orders : [orders];
    
    const mappedOrders = ordersToInsert.map(order => {
        const orderId = parseInt(order.id || order.order_id);
        return {
            order_id: !isNaN(orderId) ? orderId : Math.floor(Date.now() + Math.random() * 1000),
            customers: order.customer || order.userId,
            product: order.product,
            status: order.status || 'Pending',
            amount: order.amount,
            image: order.image, // New: save product image with order
            date: order.date || new Date().toISOString()
        };
    });
    
    const { data, error } = await supabase.from('orders').insert(mappedOrders).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Order(s) saved successfully', data });
});

app.put('/api/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    let updates = req.body;
    console.log(`Attempting to update order ${orderId} with:`, updates);

    // Map 'customer' to 'customers' if present in updates
    if (updates.customer) {
        updates.customers = updates.customer;
        delete updates.customer;
    }
    
    // Ensure order_id is not in updates as it's the primary key
    delete updates.order_id;
    delete updates.id;
    
    const { data, error } = await supabase
        .from('orders')
        .update(updates)
        .eq('order_id', orderId)
        .select();
    
    if (error) {
        console.error(`Error updating order ${orderId}:`, error);
        return res.status(500).json({ error: error.message });
    }
    
    if (!data || data.length === 0) {
        console.log(`No order found with order_id: ${orderId}`);
        return res.status(404).json({ error: 'Order not found' });
    }

    console.log(`Order ${orderId} updated successfully:`, data[0]);
    res.json({ message: 'Order updated successfully', data });
});

app.delete('/api/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    
    const { data, error } = await supabase
        .from('orders')
        .delete()
        .eq('order_id', orderId);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Order deleted successfully', data });
});

// 8. Update User Avatar
app.put('/api/users/:userId/avatar', async (req, res) => {
    const { userId } = req.params;
    const { avatar } = req.body;
    
    const { data, error } = await supabase
        .from('users')
        .update({ avatar })
        .eq('id', userId)
        .select();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Avatar updated successfully', data });
});

// 9. Get User by ID
app.get('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;
    
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

 app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
    console.log(`Local access: http://localhost:${PORT}`);
});